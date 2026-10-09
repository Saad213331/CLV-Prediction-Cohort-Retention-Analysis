# Live Predictions add-on (Olist CLV)

Ye files apne existing olist-dashboard folder me **upar se copy** kar dein (same folder structure, server.js replace hoga).

## Files
- server.js                 -> updated (sirf /api/predict routes add hue, baqi same)
- lib/predict.js            -> prediction engine (LightGBM + XGBoost trees Node me chalte hain, koi package nahi)
- public/predict.html, css/predict.css, js/predict.js -> live predictions page
- ml/train_model.py         -> model dobara train + export karne ki script
- data/model_live.json      -> trained model (data/olist_merged.csv se bana hua)

## Run
1. Zip ko apne project folder me extract karein (server.js replace karne dein)
2. node server.js
3. Terminal me "Live predictions ON (model check OK ...)" aana chahiye
4. Browser: http://localhost:3000/predict.html

## Dashboard me link lagana
Apne public/index.html ke nav/menu me ye line add karein:
   <a href="/predict.html">Live Predictions</a>

## Model dobara train karna (optional)
   pip install pandas scikit-learn lightgbm xgboost imbalanced-learn
   python ml/train_model.py --csv "D:\path\to\olist_merged.csv"
Phir server restart karein.

## API
- POST /api/predict        body: avg_order_value, avg_price, avg_freight_ratio, avg_delivery_days, late_rate,
                           avg_review, n_categories, weekend_rate, recency_days, state, payment
- GET  /api/predict/meta   form defaults + model metrics
- GET  /api/predict/sample random held-out real customer (actual result ke saath)
