import { Step } from "../lib/api";

const MODULE_COLOR: Record<string, string> = {
  vsr: "bg-amber-100 text-amber-700 border-amber-300",
  correct: "bg-violet-100 text-violet-700 border-violet-300",
};

function Field({ label, value }: { label: string; value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="mt-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-2.5 text-xs leading-relaxed text-gray-700">
        {text}
      </pre>
    </div>
  );
}

export default function StepsTrace({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <div className="space-y-2">
      {steps.map((step, i) => (
        <details
          key={i}
          className="group rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 open:bg-gray-100/70"
        >
          <summary className="flex cursor-pointer select-none items-center gap-2.5 text-sm">
            <span className="text-gray-400">{i + 1}</span>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                MODULE_COLOR[step.module] || "bg-gray-100 text-gray-600 border-gray-300"
              }`}
            >
              {step.module}
            </span>
            <span className="truncate text-gray-500">
              {String(
                (step.response as Record<string, unknown>).corrected ??
                  (step.response as Record<string, unknown>).raw_transcription ??
                  ""
              )}
            </span>
            <span className="ml-auto text-gray-400 transition group-open:rotate-90">›</span>
          </summary>
          {/* Full trace per the workshop requirements: module, prompt, response. */}
          {Object.entries(step.prompt).map(([k, v]) => (
            <Field key={k} label={`prompt - ${k}`} value={v} />
          ))}
          <Field label="response" value={step.response} />
        </details>
      ))}
    </div>
  );
}
