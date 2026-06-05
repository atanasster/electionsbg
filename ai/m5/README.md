# M5 — fine-tune a small model for reliable tool selection

Optional. Small generic models (Qwen-1.5B) route Bulgarian poorly; a
Bulgarian-native model (BgGPT, via M0) is much better, but a quick **LoRA
fine-tune** on synthetic `question → {tool, args}` pairs makes *any* small model
reliable on this **fixed 49-tool surface** — it only has to learn the mapping.

Do this only if, after M0, BgGPT's tool selection still misroutes.

## 1. Generate the dataset

```bash
npx tsx ai/m5/gen_dataset.ts
# -> ai/m5/dataset/toolcalls.train.jsonl  (~870 examples)
#    ai/m5/dataset/toolcalls.eval.jsonl   (~100 examples)
```

Each line is chat-format (`messages`: a lean system prompt with the tool
catalogue, the user question, and the assistant's `{"tool":...,"args":{...}}`).
Questions are templated over **real entities** (parties, 18 municipalities, the
oblasts, agencies, ministries, macro indicators, election dates) in BG + EN, so
the model sees the actual names it will be asked about. The dataset is gitignored
(regenerate on demand). Extend coverage by adding templates/entities in
`gen_dataset.ts`.

## 2. LoRA fine-tune (free Colab / any GPU)

Use your tool of choice — the JSONL is standard chat format. With **unsloth**
(fast, fits a free T4):

```python
# pip install unsloth
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig

model, tok = FastLanguageModel.from_pretrained(
    "INSAIT-Institute/BgGPT-Gemma-2-2.6B-IT-v1.0", load_in_4bit=True, max_seq_length=2048)
model = FastLanguageModel.get_peft_model(model, r=16, lora_alpha=16,
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"])

ds = load_dataset("json", data_files="ai/m5/dataset/toolcalls.train.jsonl")["train"]
ds = ds.map(lambda e: {"text": tok.apply_chat_template(e["messages"], tokenize=False)})

SFTTrainer(model=model, tokenizer=tok, train_dataset=ds,
    args=SFTConfig(per_device_train_batch_size=2, gradient_accumulation_steps=4,
        num_train_epochs=2, learning_rate=2e-4, output_dir="bggpt-tools-lora")).train()

model.save_pretrained_merged("bggpt-tools-merged", tok)   # merge LoRA into weights
```

2 epochs is plenty for a fixed tool surface. Hold out `toolcalls.eval.jsonl` to
sanity-check tool-match accuracy before merging.

## 3. Compile + ship

Point `ai/m0/build-model.sh` at the **merged** model (set `HF_SRC` to your merged
repo or local path), run convert/compile, host on HF, and update
`ai/llm/models.ts` — same as M0. The fine-tuned model then drives the picker.

## Notes

- Keep the training system prompt (`buildToolTrainSystemPrompt`) in sync with the
  registry — regenerate the dataset whenever you add/rename tools.
- This trains **tool selection only**. Narration uses the template fallback and
  doesn't need fine-tuning; the two-brain split keeps numbers exact regardless.
