#! /usr/bin/env python
# -*- coding: utf-8 -*-

# Copyright 2023 Imperial College London (Pingchuan Ma)
# Apache 2.0  (http://www.apache.org/licenses/LICENSE-2.0)

import os
import torch
import pickle
from configparser import ConfigParser

from pipelines.model import AVSR
from pipelines.data.data_module import AVSRDataLoader


class InferencePipeline(torch.nn.Module):
    def __init__(self, config_filename, detector="retinaface", face_track=False, device="cpu"):
        super(InferencePipeline, self).__init__()
        assert os.path.isfile(config_filename), f"config_filename: {config_filename} does not exist."

        config = ConfigParser()
        config.read(config_filename)

        modality = config.get("input", "modality")
        self.modality = modality
        input_v_fps = config.getfloat("input", "v_fps")
        model_v_fps = config.getfloat("model", "v_fps")

        model_path = config.get("model","model_path")
        model_conf = config.get("model","model_conf")

        rnnlm = config.get("model", "rnnlm")
        rnnlm_conf = config.get("model", "rnnlm_conf")
        penalty = config.getfloat("decode", "penalty")
        ctc_weight = config.getfloat("decode", "ctc_weight")
        lm_weight = config.getfloat("decode", "lm_weight")
        beam_size = config.getint("decode", "beam_size")

        self.dataloader = AVSRDataLoader(modality, speed_rate=input_v_fps/model_v_fps, detector=detector)
        self.model = AVSR(modality, model_path, model_conf, rnnlm, rnnlm_conf, penalty, ctc_weight, lm_weight, beam_size, device)
        if face_track and self.modality in ["video", "audiovisual"]:
            if detector == "mediapipe":
                from pipelines.detectors.mediapipe.detector import LandmarksDetector
                self.landmarks_detector = LandmarksDetector()
            if detector == "retinaface":
                from pipelines.detectors.retinaface.detector import LandmarksDetector
                self.landmarks_detector = LandmarksDetector(device=str(device))
        else:
            self.landmarks_detector = None


    def process_landmarks(self, data_filename, landmarks_filename):
        if self.modality == "audio":
            return None
        if self.modality in ["video", "audiovisual"]:
            if isinstance(landmarks_filename, str):
                landmarks = pickle.load(open(landmarks_filename, "rb"))
            else:
                landmarks = self.landmarks_detector(data_filename)
            return landmarks


    def forward(self, data_filename, landmarks_filename=None):
        # data_filename may also be an already-decoded (T, H, W, 3) RGB frame array
        if isinstance(data_filename, str):
            assert os.path.isfile(data_filename), f"data_filename: {data_filename} does not exist."
        landmarks = self.process_landmarks(data_filename, landmarks_filename)
        data = self.dataloader.load_data(data_filename, landmarks)
        transcript = self.model.infer(data)
        return transcript