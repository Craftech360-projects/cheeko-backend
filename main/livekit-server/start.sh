#!/bin/bash
# Wrapper script to filter NNPACK warnings from PyTorch
cd /root/xiaozhi-esp32-server/main/livekit-server
python3 main.py "$@" 2> >(grep -v "NNPACK.cpp" >&2)
