import { Captions, Film, Images, Layers, ListOrdered, ScanText, TextQuote } from 'lucide-react'

// What each choice of the menu does; the server says which ones fit a link.
export const ACTIONS = {
  posts: {
    icon: ListOrdered,
    title: 'Liste des posts',
    description: "L'URL de chaque post, à copier ou en .txt / .csv",
  },
  'carousel-text': {
    icon: ScanText,
    title: 'Texte des carrousels',
    description: 'Le texte de chaque slide, exporté en .csv, .json et .md',
  },
  'all-text': {
    icon: TextQuote,
    title: 'Texte de tous les posts',
    description: 'Transcription des vidéos et texte des carrousels, exportés ensemble',
  },
  batch: {
    icon: Layers,
    title: 'Texte de chaque lien',
    description: 'Transcription des vidéos et texte des carrousels, exportés en .csv, .json et .md',
  },
  video: {
    icon: Captions,
    title: 'Vidéo + transcription',
    description: 'Le MP4 et le texte de ce qui est dit (.txt, .srt)',
  },
  'video-only': {
    icon: Film,
    title: 'Vidéo seule',
    description: 'Juste le MP4, sans transcription : plus rapide',
  },
  carousel: {
    icon: Images,
    title: 'Slides + texte',
    description: 'Les images en .zip, le son, et le texte de chaque slide',
  },
}

export const KIND_LABELS = {
  account: 'Compte',
  video: 'Vidéo',
  carousel: 'Carrousel',
}
