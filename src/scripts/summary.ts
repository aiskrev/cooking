// Оценки и брой коментари по картите на рецептите – само когато има реални данни. Без данни картите остават непроменени.
const cards = [...document.querySelectorAll<HTMLElement>('[data-slug][data-rating-slot-host], [data-card][data-slug]')];
const slots = document.querySelectorAll<HTMLElement>('[data-rating-slot]');
if (slots.length || cards.length) {
  fetch('/api/public/summary', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { summary: Record<string, { ratings: number; average: number | null; comments: number }> } | null) => {
      if (!j) return;
      const s = j.summary;
      document.querySelectorAll<HTMLElement>('[data-slug]').forEach((card) => {
        const d = s[card.dataset.slug!];
        if (!d) return;
        if (d.average != null) card.dataset.rating = String(d.average);
        const slot = card.querySelector<HTMLElement>('[data-rating-slot]');
        if (!slot) return;
        const parts: string[] = [];
        if (d.ratings) parts.push(`★ ${String(d.average).replace('.', ',')} (${d.ratings})`);
        if (d.comments) parts.push(`${d.comments} ${d.comments === 1 ? 'коментар' : 'коментара'}`);
        if (parts.length) { slot.textContent = parts.join(' · '); slot.hidden = false; }
      });
      document.dispatchEvent(new CustomEvent('community:summary', { detail: s }));
    })
    .catch(() => { /* API-то не е налично – сайтът работи и без него */ });
}
