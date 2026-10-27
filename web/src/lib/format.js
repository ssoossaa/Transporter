import { toast } from 'sonner'

export function fileUrl(job, file, download = false) {
  return `/files/${job.id}/${file.path}${download ? '?download=1' : ''}`
}

export function formatTime(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
export const countFormat = new Intl.NumberFormat('fr-FR', { notation: 'compact' })

export const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`

export async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(message)
  } catch {
    toast.error('Impossible de copier : ton navigateur a bloqué le presse-papier.')
  }
}
