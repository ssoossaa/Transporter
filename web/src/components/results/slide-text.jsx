// A carousel's text, slide by slide, as read by the OCR.
export function SlideText({ slides }) {
  return (
    <ol className="grid gap-4">
      {slides.map((s) => (
        <li key={s.n} className="grid grid-cols-[36px_1fr] gap-3">
          <span className="h-fit w-fit rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-cyan tabular-nums">
            {s.n}
          </span>
          <p className="leading-relaxed whitespace-pre-wrap">
            {s.text || <span className="text-muted-foreground">Pas de texte</span>}
          </p>
        </li>
      ))}
    </ol>
  )
}
