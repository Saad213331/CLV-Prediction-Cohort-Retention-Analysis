"""
Live predictions ke liye models train karta hai aur data/model_live.json me export karta hai.
Node.js is JSON ko directly padh kar predictions deta hai (Python runtime ki zaroorat nahi).

Run:  python ml/train_model.py            (data/olist_merged.csv use hota hai)
      python ml/train_model.py --csv "D:\\git\\olist_merged.csv"
"""
import argparse
import json
import re
import time
from pathlib import Path

import numpy as np
import pandas as pd
from imblearn.over_sampling import SMOTE
from lightgbm import LGBMClassifier, early_stopping
from sklearn.metrics import (average_precision_score, f1_score, mean_absolute_error, precision_score,
                             r2_score, recall_score, roc_auc_score)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--csv", default=str(ROOT / "data" / "olist_merged.csv"))
args = ap.parse_args()
t0 = time.time()
log = lambda m: print(f"[{time.time() - t0:5.1f}s] {m}", flush=True)

DATES = ["order_purchase_timestamp", "order_approved_at", "order_delivered_carrier_date",
         "order_delivered_customer_date", "order_estimated_delivery_date"]
df = pd.read_csv(args.csv, parse_dates=DATES)
log(f"Loaded {len(df)} orders")

# ---------- Cleaning (notebook jaisa; agar CSV pehle se clean hai to skip) ----------
if "is_delivered" not in df.columns:
    df["is_delivered"] = df["order_delivered_customer_date"].notna().astype(int)
    gap = (df["order_approved_at"] - df["order_purchase_timestamp"]).median()
    df["order_approved_at"] = df["order_approved_at"].fillna(df["order_purchase_timestamp"] + gap)
    m = df["payment_value"].isna()
    df.loc[m, "payment_value"] = df.loc[m, "price"] + df.loc[m, "freight"]
    num = ["n_items", "n_sellers", "price", "freight", "payment_value"]
    df[num] = df[num].fillna(0)
    df["main_category"] = df["main_category"].fillna("unknown")
    df["installments"] = df["installments"].fillna(df["installments"].mode()[0])
    df["payment_type"] = df["payment_type"].fillna("not_defined")
    df["review_score"] = df["review_score"].fillna(df["review_score"].median())
    g1 = (df["order_delivered_carrier_date"] - df["order_approved_at"]).median()
    g2 = (df["order_delivered_customer_date"] - df["order_delivered_carrier_date"]).median()
    df["order_delivered_carrier_date"] = df["order_delivered_carrier_date"].fillna(df["order_approved_at"] + g1)
    df["order_delivered_customer_date"] = df["order_delivered_customer_date"].fillna(
        df["order_delivered_carrier_date"] + g2)
if "price_capped" not in df.columns:
    for c in ["price", "freight", "payment_value"]:
        df[c + "_capped"] = df[c].clip(df[c].quantile(0.01), df[c].quantile(0.99))
df["delivery_days"] = (df["order_delivered_customer_date"] - df["order_purchase_timestamp"]).dt.days
df["delivery_days"] = df["delivery_days"].where(df["is_delivered"] == 1)

# ---------- Feature engineering (time split: 2018-03-01) ----------
df["is_weekend"] = df["order_purchase_timestamp"].dt.dayofweek.isin([5, 6]).astype(int)
df["delay_days"] = (df["order_delivered_customer_date"] - df["order_estimated_delivery_date"]).dt.days
df["is_late"] = ((df["delay_days"] > 0) & (df["is_delivered"] == 1)).astype(int)
df["freight_ratio"] = df["freight_capped"] / df["price_capped"].replace(0, np.nan)
top_cat = df["main_category"].value_counts().head(10).index
df["cat_grouped"] = df["main_category"].where(df["main_category"].isin(top_cat), "other")
top_states = df["customer_state"].value_counts().head(5).index
df["state_grouped"] = df["customer_state"].where(df["customer_state"].isin(top_states), "other")

SPLIT = pd.Timestamp("2018-03-01")
obs = df[df["order_purchase_timestamp"] < SPLIT]
cust = obs[obs["order_status"] != "canceled"].groupby("customer_unique_id").agg(
    frequency=("order_purchase_timestamp", "nunique"), monetary=("payment_value_capped", "sum"),
    avg_order_value=("payment_value_capped", "mean"), avg_price=("price_capped", "mean"),
    avg_freight_ratio=("freight_ratio", "mean"), avg_delivery_days=("delivery_days", "mean"),
    late_rate=("is_late", "mean"), avg_review=("review_score", "mean"),
    n_categories=("cat_grouped", "nunique"), weekend_rate=("is_weekend", "mean"),
    last_purchase=("order_purchase_timestamp", "max"),
    top_state=("state_grouped", lambda x: x.mode()[0]),
    top_payment=("payment_type", lambda x: x.mode()[0])).reset_index()
cust["recency_days"] = (obs["order_purchase_timestamp"].max() - cust["last_purchase"]).dt.days
cust["is_repeat"] = (cust["frequency"] > 1).astype(int)
for c in ["avg_delivery_days", "avg_freight_ratio"]:
    cust[c] = cust[c].fillna(cust[c].median())
for c in ["monetary", "avg_order_value", "avg_price"]:
    cust[c] = cust[c].clip(cust[c].quantile(0.01), cust[c].quantile(0.99))

NUM = ["avg_order_value", "avg_price", "avg_freight_ratio", "avg_delivery_days", "late_rate",
       "avg_review", "n_categories", "weekend_rate", "recency_days"]
dummies = pd.get_dummies(cust[["top_state", "top_payment"]], drop_first=True).astype(int)
FEATURES = NUM + list(dummies.columns)
X = pd.concat([cust[NUM], dummies], axis=1)[FEATURES]
y, spend = cust["is_repeat"], cust["monetary"]
log(f"Customers: {len(cust)} | repeat rate {y.mean() * 100:.2f}% | features: {len(FEATURES)}")

states_all = sorted(cust["top_state"].unique())
pays_all = sorted(cust["top_payment"].unique())
state_opts = [c.replace("top_state_", "") for c in dummies.columns if c.startswith("top_state_")]
pay_opts = [c.replace("top_payment_", "") for c in dummies.columns if c.startswith("top_payment_")]
state_base = [s for s in states_all if s not in state_opts][0]
pay_base = [s for s in pays_all if s not in pay_opts][0]

# ---------- Stage 1: repeat classifier (SMOTE sirf train par) ----------
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)
sc = StandardScaler().fit(Xtr)
Xtr_s, Xte_s = sc.transform(Xtr), sc.transform(Xte)
Xa, Xv, ya, yv = train_test_split(Xtr_s, ytr, test_size=0.15, stratify=ytr, random_state=42)
Xa_b, ya_b = SMOTE(random_state=42).fit_resample(Xa, ya)
PRIOR = float(ytr.mean())
clf = LGBMClassifier(n_estimators=638, num_leaves=145, max_depth=11, learning_rate=0.2744,
                     min_child_samples=54, colsample_bytree=0.74, reg_alpha=0.005, reg_lambda=0.416,
                     random_state=42, verbose=-1)
clf.fit(Xa_b, ya_b, eval_set=[(Xv, yv)], eval_metric="auc", callbacks=[early_stopping(50, verbose=False)])
p_te = clf.predict_proba(Xte_s)[:, 1]
pred_te = (p_te >= 0.5).astype(int)
log(f"Classifier: best iter {clf.best_iteration_}, test AUC {roc_auc_score(yte, p_te):.4f}")

# ---------- Stage 2: spend regressor (sirf repeat customers) ----------
rtr, rte = ytr[ytr == 1].index, yte[yte == 1].index
sc_r = StandardScaler().fit(X.loc[rtr])
reg = XGBRegressor(n_estimators=300, max_depth=5, learning_rate=0.05, random_state=42)
reg.fit(sc_r.transform(X.loc[rtr]), spend.loc[rtr])
sp_te = reg.predict(sc_r.transform(X.loc[rte]))
log(f"Regressor: test R2 {r2_score(spend.loc[rte], sp_te):.4f}")


def adjust(p):
    return p * PRIOR / (p * PRIOR + (1 - p) * (1 - PRIOR))


def score_df(frame):
    p = adjust(clf.predict_proba(sc.transform(frame))[:, 1])
    s = np.clip(reg.predict(sc_r.transform(frame)), 0, None)
    return p, s


p_all, s_all = score_df(X)
score_all = p_all * s_all
cut = {"p50": float(np.quantile(score_all, 0.50)), "p80": float(np.quantile(score_all, 0.80)),
       "p95": float(np.quantile(score_all, 0.95))}

# ---------- Trees ko compact nested arrays me export ----------
def conv_lgb(n):
    if "leaf_value" in n:
        return n["leaf_value"]
    return [n["split_feature"], n["threshold"], conv_lgb(n["left_child"]), conv_lgb(n["right_child"])]


def conv_xgb(n):
    if "leaf" in n:
        return n["leaf"]
    kids = {c["nodeid"]: c for c in n["children"]}
    return [int(n["split"][1:]), n["split_condition"], conv_xgb(kids[n["yes"]]), conv_xgb(kids[n["no"]])]


lgb_trees = [conv_lgb(t["tree_structure"]) for t in
             clf.booster_.dump_model(num_iteration=clf.best_iteration_)["tree_info"]]
xgb_trees = [conv_xgb(json.loads(t)) for t in reg.get_booster().get_dump(dump_format="json")]
base = json.loads(reg.get_booster().save_config())["learner"]["learner_model_param"]["base_score"]
xgb_base = float(re.findall(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", base)[0])

# ---------- Real held-out customers (test split) + parity check samples ----------
def row_dict(i):
    r = cust.loc[i]
    d = {k: round(float(r[k]), 4) for k in NUM}
    d["state"] = r["top_state"]
    d["payment"] = r["top_payment"]
    return d


rng = np.random.RandomState(7)
pos = list(yte[yte == 1].index)
neg = list(yte[yte == 0].index)
pick = list(rng.choice(pos, min(120, len(pos)), replace=False)) + list(rng.choice(neg, 240, replace=False))
samples = []
for i in pick:
    r = cust.loc[i]
    samples.append({"id": r["customer_unique_id"][:12], "input": row_dict(i), "actual_repeat": int(r["is_repeat"]),
                    "orders": int(r["frequency"]), "spent": round(float(r["monetary"]), 2)})
rng.shuffle(samples)

chk_idx = list(rng.choice(Xte.index, 8, replace=False))
chk = []
for i in chk_idx:
    raw = float(clf.predict_proba(sc.transform(X.loc[[i]]))[:, 1][0])
    chk.append({"input": row_dict(i), "p_raw": raw, "p_adj": float(adjust(raw)),
                "spend": float(max(reg.predict(sc_r.transform(X.loc[[i]]))[0], 0))})

stats = {k: {"min": float(X[k].min()), "p01": float(X[k].quantile(.01)), "median": float(X[k].median()),
             "p99": float(X[k].quantile(.99)), "max": float(X[k].max())} for k in NUM}
out = {
    "features": FEATURES, "numeric": NUM, "dummy_cols": list(dummies.columns), "prior": PRIOR,
    "scaler": {"mean": sc.mean_.tolist(), "scale": sc.scale_.tolist()},
    "scaler_reg": {"mean": sc_r.mean_.tolist(), "scale": sc_r.scale_.tolist()},
    "lgb_trees": lgb_trees, "xgb_trees": xgb_trees, "xgb_base": xgb_base,
    "categories": {"state": {"baseline": state_base, "options": [state_base] + state_opts},
                   "payment": {"baseline": pay_base, "options": [pay_base] + pay_opts}},
    "defaults": {**{k: round(stats[k]["median"], 4) for k in NUM},
                 "state": cust["top_state"].mode()[0], "payment": cust["top_payment"].mode()[0]},
    "stats": stats, "cutoffs": cut, "samples": samples, "check": chk,
    "card": {"customers": int(len(cust)), "repeat_rate": round(float(y.mean() * 100), 2), "split_date": str(SPLIT.date()),
             "classifier": "LightGBM + SMOTE", "best_iteration": int(clf.best_iteration_),
             "roc_auc": round(float(roc_auc_score(yte, p_te)), 4), "pr_auc": round(float(average_precision_score(yte, p_te)), 4),
             "precision": round(float(precision_score(yte, pred_te)), 4), "recall": round(float(recall_score(yte, pred_te)), 4),
             "f1": round(float(f1_score(yte, pred_te)), 4), "regressor": "XGBoost",
             "reg_mae": round(float(mean_absolute_error(spend.loc[rte], sp_te)), 2),
             "reg_r2": round(float(r2_score(spend.loc[rte], sp_te)), 4)},
}
path = ROOT / "data" / "model_live.json"
path.write_text(json.dumps(out, separators=(",", ":")))
log(f"Saved {path} ({path.stat().st_size / 1e6:.2f} MB)")
