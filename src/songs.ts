export const SONGS = [
  { id: 'duelo', title: 'Duelo', path: '/duelo.json' },
  { id: 'luz-y-sal', title: 'Luz y sal', path: '/luz-y-sal.json' },
  { id: 'paso', title: 'Paso', path: '/paso.json' },
  { id: 'pimiento', title: 'Pimiento', path: '/pimiento.json' },
  { id: 'vidas', title: 'Vidas', path: '/vidas.json' },
] as const

export type SongId = (typeof SONGS)[number]['id']
