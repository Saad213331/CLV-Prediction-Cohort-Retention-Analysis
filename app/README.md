# Olist CLV - Live Predictions (HTML + CSS + Node.js)

Koi npm package install nahi karna - sirf Node.js (v16+) chahiye: https://nodejs.org

## Run karne ke steps (Windows)
1. Zip ko extract karein, e.g. `D:\olist-clv-live`
2. VS Code / CMD me folder kholein:  `cd D:\olist-clv-live`
3. `node server.js`
4. Terminal me "Live predictions ON (model check OK ...)" aana chahiye
5. Browser me kholein: http://localhost:3000   (band karne ke liye Ctrl + C)

Port badalna ho:  `set PORT=4000 && node server.js`

## Apne notebook ki files lagana
Notebook (`olist_clv_pipeline.ipynb`) ka **aakhri cell (Live Prediction Export)** chalane par `clv_outputs` folder me ye 2 files banti hain:
- `model_live.json`          (trained models, live predictions ke liye)
- `clv_scored_customers.csv` (har customer ka CLV score aur segment)

Dono ko `data/` folder me copy karke purani files replace kar dein, phir `node server.js` dobara chalayein.
(Is zip me meri chalayi hui sample files pehle se maujood hain, is liye app foran chal jati hai.)

## App ke 3 tabs
- **Live Prediction:** customer ke pehle order ki values badlein, repeat chance / predicted spend / segment foran update hota hai. "Random real customer" test set ka asli customer load karta hai aur uska asal result dikhata hai.
- **Customers:** scored customers ki list (search, segment filter, sort, pages).
- **Model:** metrics, ROC, confusion matrix, lift, feature importance, model comparison.

## Sir ko demo dene ka flow (3-4 minute)
1. Live Prediction: "Happy first-time buyer" aur "Late delivery, unhappy" presets dikhayein - review/delivery badalne par chance badalta hai.
2. "Random real customer" dabayein - model ka prediction aur asal result saath dikhta hai.
3. Customers tab: Platinum segment filter - in customers ka repeat rate baaqi se zyada hai.
4. Model tab: honest baat batayein - repeat purchase 2.7% hai (36:1 imbalance), pehle order se predict karna mushkil hai, is liye AUC ~0.58; model ranking ke liye hai, guarantee ke liye nahi.

## Folder structure
- server.js            -> Node server + API (/api/predict, /api/meta, /api/sample, /api/customers, /api/overview, /api/model)
- lib/predict.js       -> LightGBM trees ko Node me chalane wala engine (Python se match check startup par)
- lib/customers.js     -> scored customers CSV loader
- data/                -> model_live.json, clv_scored_customers.csv
- public/              -> index.html, css/style.css, js/app.js
