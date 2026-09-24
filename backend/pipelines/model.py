#! /usr/bin/env python
# -*- coding: utf-8 -*-

# Copyright 2023 Imperial College London (Pingchuan Ma)
# Apache 2.0  (http://www.apache.org/licenses/LICENSE-2.0)

import os
import json
import torch
import argparse
import numpy as np

from espnet.asr.asr_utils import torch_load
from espnet.asr.asr_utils import get_model_conf
from espnet.asr.asr_utils import add_results_to_json
from espnet.nets.batch_beam_search import BatchBeamSearch
from espnet.nets.lm_interface import dynamic_import_lm
from espnet.nets.scorers.length_bonus import LengthBonus
from espnet.nets.pytorch_backend.e2e_asr_transformer import E2E


class AVSR(torch.nn.Module):
    def __init__(self, modality, model_path, model_conf, rnnlm=None, rnnlm_conf=None,
        penalty=0., ctc_weight=0.1, lm_weight=0., beam_size=40, device="cpu"):
        super(AVSR, self).__init__()
        self.device = device

        if modality == "audiovisual":
            from espnet.nets.pytorch_backend.e2e_asr_transformer_av import E2E
        else:
            from espnet.nets.pytorch_backend.e2e_asr_transformer import E2E

        with open(model_conf, "rb") as f:
            confs = json.load(f)
        args = confs if isinstance(confs, dict) else confs[2]
        self.train_args = argparse.Namespace(**args)

        labels_type = getattr(self.train_args, "labels_type", "char")
        if labels_type == "char":
            self.token_list = self.train_args.char_list
        elif labels_type == "unigram5000":
            file_path = os.path.join(os.path.dirname(__file__), "tokens", "unigram5000_units.txt")
            self.token_list = ['<blank>'] + [word.split()[0] for word in open(file_path, encoding="utf-8").read().splitlines()] + ['<eos>']
        self.odim = len(self.token_list)

        self.model = E2E(self.odim, self.train_args)
        self.model.load_state_dict(torch.load(model_path, map_location=lambda storage, loc: storage))
        self.model.to(device=self.device).eval()

        self.beam_search = get_beam_search_decoder(self.model, self.token_list, rnnlm, rnnlm_conf, penalty, ctc_weight, lm_weight, beam_size)
        self.beam_search.to(device=self.device).eval()
        
    def infer(self, data):
        with torch.no_grad():
            if isinstance(data, tuple):
                enc_feats = self.model.encode(data[0].to(self.device), data[1].to(self.device))
            else:
                enc_feats = self.model.encode(data.to(self.device))

            nbest_hyps = self.beam_search(enc_feats)
            best = nbest_hyps[0].asdict()
            transcription = add_results_to_json([best], self.token_list)
            transcription = transcription.replace("▁", " ").strip().replace("<eos>", "")

            alternatives = self._ctc_word_alternatives(enc_feats)

        return transcription, alternatives

    def encode_features(self, data):
        """Encoder output only (T, D): the per-frame visual features before the text decoder."""
        with torch.no_grad():
            if isinstance(data, tuple):
                return self.model.encode(data[0].to(self.device), data[1].to(self.device))
            return self.model.encode(data.to(self.device))

    def _ctc_word_alternatives(self, enc_feats, top_k=3):
        """Per-word top-K alternatives from CTC token probabilities.

        Uses the CTC head's softmax output to get the model's visual confusion
        signal at each decoded token position, then groups tokens into words.
        """
        ctc_log_probs = self.model.ctc.log_softmax(enc_feats.unsqueeze(0))
        ctc_probs = ctc_log_probs.exp().squeeze(0)  # (T, vocab_size)
        argmax_ids = ctc_probs.argmax(dim=-1).tolist()

        decoded_positions = []
        prev_id = None
        for t, idx in enumerate(argmax_ids):
            if idx == 0 or idx == prev_id:
                prev_id = idx
                continue
            prev_id = idx
            decoded_positions.append((t, idx))

        words = []
        current_tokens = []
        for t, idx in decoded_positions:
            token = self.token_list[idx]
            if token.startswith("▁") and current_tokens:
                words.append(current_tokens)
                current_tokens = []
            current_tokens.append((t, idx, token))
        if current_tokens:
            words.append(current_tokens)

        word_alts = []
        for token_group in words:
            text = "".join(tok for _, _, tok in token_group).replace("▁", "").strip()
            if not text:
                continue

            if len(token_group) == 1:
                t, idx, _ = token_group[0]
                top_vals, top_ids = ctc_probs[t].topk(min(top_k * 3, ctc_probs.shape[-1]))
                alts = []
                for tid, val in zip(top_ids.tolist(), top_vals.tolist()):
                    alt_token = self.token_list[tid]
                    if tid == 0 or alt_token in ("<eos>", "<blank>"):
                        continue
                    alt_word = alt_token.replace("▁", "").strip()
                    if alt_word:
                        alts.append((alt_word, val))
                    if len(alts) >= top_k:
                        break
            else:
                confidence = min(ctc_probs[t, idx].item() for t, idx, _ in token_group)
                alts = [(text, confidence)]

            word_alts.append(alts)

        return word_alts


def get_beam_search_decoder(model, token_list, rnnlm=None, rnnlm_conf=None, penalty=0, ctc_weight=0.1, lm_weight=0., beam_size=40):
    sos = model.odim - 1
    eos = model.odim - 1
    scorers = model.scorers()

    if not rnnlm:
        lm = None
    else:
        lm_args = get_model_conf(rnnlm, rnnlm_conf)
        lm_model_module = getattr(lm_args, "model_module", "default")
        lm_class = dynamic_import_lm(lm_model_module, lm_args.backend)
        lm = lm_class(len(token_list), lm_args)
        torch_load(rnnlm, lm)
        lm.eval()

    scorers["lm"] = lm
    scorers["length_bonus"] = LengthBonus(len(token_list))
    weights = dict(
        decoder=1.0 - ctc_weight,
        ctc=ctc_weight,
        lm=lm_weight,
        length_bonus=penalty,
    )

    return BatchBeamSearch(
        beam_size=beam_size,
        vocab_size=len(token_list),
        weights=weights,
        scorers=scorers,
        sos=sos,
        eos=eos,
        token_list=token_list,
        pre_beam_score_key=None if ctc_weight == 1.0 else "decoder",
    )
