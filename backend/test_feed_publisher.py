"""
Unit test for FeedPublisher: frame packaging, metadata stamping, and lock field inclusion.
"""

import asyncio
import base64
import json
import numpy as np
import cv2

from feed_publisher import feed_publisher
from tracker import TrackingStatus, HardwareCommand


async def run_feed_publisher_tests():
    print("Testing FeedPublisher...")

    # Create dummy JPEG frame
    img = np.zeros((240, 320, 3), dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    frame_bytes = buf.tobytes()

    location = {
        "lat": 29.5312,
        "lng": 78.7744,
        "location_name": "Corbett Sector 4"
    }

    # 1. Test publishing when NOT locked (lock data must be None)
    unlocked_status = TrackingStatus(
        locked=False,
        state="SEARCHING",
        target_id=None,
        target_class=None,
        target_bbox=None,
        target_center=None,
        dx=0.0,
        dy=0.0,
        direction="CENTERED",
        lost_count=0,
        max_lost_threshold=10,
        match_score=0.0,
        hardware_command=HardwareCommand(90.0, 90.0, 0.0, 0.0, "SEARCH_SWEEP"),
        predicted=False
    )

    await feed_publisher.publish_frame(
        frame_bytes=frame_bytes,
        location=location,
        tracking_status=unlocked_status
    )

    item = await feed_publisher._queue.get()
    assert item["type"] == "live_feed_frame"
    assert "frame" in item and item["frame"].startswith("data:image/jpeg;base64,")
    assert item["location"]["lat"] == 29.5312
    assert item["location"]["name"] == "Corbett Sector 4"
    assert item["lock"] is None, "When unlocked, lock data must be None"
    feed_publisher._queue.task_done()
    print("  Unlocked frame test passed: Raw feed + location + timestamp published, lock is None.")

    # 2. Test publishing when LOCKED (lock data must be populated, including predicted flag)
    locked_status = TrackingStatus(
        locked=True,
        state="LOCKED",
        target_id=101,
        target_class="tiger",
        target_bbox=[0.3, 0.3, 0.5, 0.5],
        target_center=(0.4, 0.4),
        dx=-0.2,
        dy=-0.2,
        direction="UP_LEFT",
        lost_count=0,
        max_lost_threshold=10,
        match_score=0.92,
        hardware_command=HardwareCommand(85.0, 95.0, -1.0, 1.0, "TRACK_UP_LEFT"),
        predicted=False
    )

    await feed_publisher.publish_frame(
        frame_bytes=frame_bytes,
        location=location,
        tracking_status=locked_status
    )

    item_locked = await feed_publisher._queue.get()
    assert item_locked["lock"] is not None
    assert item_locked["lock"]["locked"] is True
    assert item_locked["lock"]["species"] == "tiger"
    assert item_locked["lock"]["predicted"] is False
    assert item_locked["lock"]["bbox"] == [0.3, 0.3, 0.5, 0.5]
    feed_publisher._queue.task_done()
    print("  Locked frame test passed: Lock data populated correctly.")

    # 3. Test publishing when PREDICTED
    pred_status = TrackingStatus(
        locked=True,
        state="LOST",
        target_id=101,
        target_class="tiger",
        target_bbox=[0.32, 0.32, 0.52, 0.52],
        target_center=(0.42, 0.42),
        dx=-0.16,
        dy=-0.16,
        direction="UP_LEFT",
        lost_count=2,
        max_lost_threshold=10,
        match_score=0.0,
        hardware_command=HardwareCommand(86.0, 94.0, -0.8, 0.8, "TRACK_UP_LEFT"),
        predicted=True
    )

    await feed_publisher.publish_frame(
        frame_bytes=frame_bytes,
        location=location,
        tracking_status=pred_status
    )

    item_pred = await feed_publisher._queue.get()
    assert item_pred["lock"] is not None
    assert item_pred["lock"]["predicted"] is True
    assert item_pred["lock"]["lost_count"] == 2
    feed_publisher._queue.task_done()
    print("  Predicted frame test passed: predicted flag is True and included in lock telemetry.")

    print("\n[PASS] All FeedPublisher unit tests passed successfully!\n")


if __name__ == "__main__":
    asyncio.run(run_feed_publisher_tests())
