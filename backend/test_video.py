"""
Quick test for detect_video function.
Creates a small synthetic video with cv2, processes it through detect_video,
and checks the returned structure.
"""

import numpy as np
import cv2
import tempfile
import os
from inference import detect_video

# Create a small 2-second video at 10 fps
width, height = 320, 240
fps = 10.0
total_frames = 20

with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as f_in:
    in_path = f_in.name

with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as f_out:
    out_path = f_out.name

try:
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(in_path, fourcc, fps, (width, height))
    for i in range(total_frames):
        # Create a frame with some varying content
        frame = np.full((height, width, 3), 120, dtype=np.uint8)
        cv2.putText(frame, f"Frame {i}", (30, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
        writer.write(frame)
    writer.release()

    res = detect_video(video_path=in_path, output_path=out_path, conf_threshold=0.25, frame_stride=2)
    print("Video info:", res["video_info"])
    print("Summary:", res["summary"])
    assert res["video_info"]["processed_frames"] == 10
    print("Video test PASSED successfully!")
finally:
    if os.path.exists(in_path):
        os.remove(in_path)
    if os.path.exists(out_path):
        os.remove(out_path)
