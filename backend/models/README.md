# SentryWing Model Weights Directory

Drop your trained **SentryWing YOLO11s** weights file here.

## Required

Place **one** of the following:

| Filename         | Format                    | Notes                                         |
|------------------|---------------------------|-----------------------------------------------|
| `detector.pt`    | Ultralytics YOLO (.pt)    | **Recommended.** Loaded via `ultralytics.YOLO` |
| `detector.onnx`  | ONNX Runtime (.onnx)      | Exported from your trained .pt via `model.export(format="onnx")` |

## Expected Class Order (8 classes)

The model must be trained on these classes in this exact order:

```
0: tiger
1: cheetah
2: lion
3: hyena
4: leopard
5: bear
6: fox
7: elephant
```

## How to get your weights here

If you trained on Google Colab using the SentryWing notebook:

1. Download `sentrywing_best.pt` from your Google Drive 
   (`/MyDrive/SentryWing_9Species/models/sentrywing_best.pt`)
2. Rename it to `detector.pt`
3. Place it in this directory (`backend/models/detector.pt`)

## Hot-Reload

You can drop weights here while the server is running and either:
- Click **RELOAD MODELS** in the frontend settings drawer, or
- Send `POST http://localhost:8000/api/models/reload`

The server will pick up the new weights without a restart.

## Stage 2: Attribute Engine

Stage 2 is a **rule-based attribute engine** (not a neural network).  
It does NOT require any separate model file — it runs automatically  
on the cropped bounding box of the locked target and estimates:

- **Age group** (juvenile / subadult / adult / mature) with species-specific year ranges
- **Sex** (heuristic estimate from image statistics)
- **Body size** (small / medium / large) with indicative weight bands
- **Behaviour** (horizontal / vertical / standing posture)
- **Image quality flags** (dark, overexposed, blur detection)
