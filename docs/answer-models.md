# Local answer models

The answer model picker is separate from the decision-engine picker. Ordinary
Agent direct answers route eligible simple tasks to Houmo Qwen3.5-4B and complex local
tasks to Houmo Qwen3.5-9B. Existing authorized cloud rules still apply. Project
tool execution retains 9B/DeepSeek routing and locks the answer, decision engine
and local/cloud scope for the whole task. 27B remains manual ordinary chat.

| Route | Answer | Backend | Preparation |
| --- | --- | --- | --- |
| small | Qwen3.5-4B | Houmo W4A8 | Shared fixed 4B loopback service |
| tiny | Qwen3.5-2B | Houmo W8A16 | Manual, shared fixed 2B service |
| standard | Qwen3.5-9B | Houmo W4A8 | Existing primary service |
| vision | MiniCPM-V 4.7 1B | CPU Q4_K_M + F16 projector | Manual, existing 17747 service |
| large | Qwen3.8-27B-MTP | Houmo W4A8 | Explicit manual switch |
| cpu | MiniCPM5-2B | CPU Q4_K_M | Manual compatibility option |

The 2B and 4B decision servers also answer ordinary text requests. Their exact
rendered template and output reserve count toward the 4096-token budget.
Preparations are serialized by the device gate; only one small Houmo service
stays loaded with 9B to retain card headroom. Selecting 2B as decider and 4B as
answer can cause two cold preparations. Choosing the 4B decider can reuse that
service. Preparation time is separate from warm generation throughput. These
servers do not gain Agent eligibility from classification scores.

MiniCPM-V is a CPU route. Platform-level Houmo support does not establish that
an exact LQ50 4.7-1B deployment package has been installed. Model weights and
projectors retain their upstream licenses and stay outside MIT sources.

## Image input

Agent direct answers accept uploaded/pasted PNG, JPEG and WebP through the existing
Harness composer. The browser resizes images; the backend independently checks
data URLs, signatures, count and byte limits. Auto images use 9B; manual images
use 9B or MiniCPM-V. Images never select cloud. Project tools remain text-only.

For follow-ups in the same browser, validated image parts are reattached only
to matching completed user turns, in recent chronological order. The server's
authoritative text stays unchanged and the full merged input is reviewed again.
Cross-device history restores text; images require uploading again if the local
browser no longer has them. Unrelated images are never attached to another turn.

A fixed local 9B visual screen describes the image and extracts visible text.
It cannot execute tools or choose endpoints. An exact full-input digest binds
the in-memory result for 90 seconds. AI Gateway's authenticated input Block hook
requires this result, checks risk and extracted text, then applies the existing
semantic guard. Missing, malformed, truncated, uncertain and failed reviews
stop; they are not recorded as confirmed content violations. A visual screen
may run before AI Gateway, but no answer inference runs until the gateway allows
the request. Monitor still reuses the same routing decision.

This is model-assisted screening, not a certified image safety detector. Small
synthetic acceptance samples do not establish real-world harmful-image recall
or OCR reliability. The original images are not sent to the cloud. Captions and
OCR are not added to normal event logs; they exist in a bounded short-lived
memory cache. Existing AI Gateway raw capture and authorized successful chat
history retain their configured content policy. Streaming output remains
unreviewed; do not describe it as output Block.

Safety and routing evidence, cold/warm timings, host RSS and card memory belong
in the deployment's private report and dashboard, separate from historical
classification experiments. Old completed messages keep their recorded model
names; historical measurements are not relabeled as the new 4B route.
