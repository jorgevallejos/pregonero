export const SONGS = [
  { id: 'vidas', title: 'Vidas', path: 'vidas.json' },
  { id: 'libertad', title: 'Libertad', path: 'libertad.json' },
  { id: 'soy-una-puerta', title: 'Soy una puerta', path: 'soy-una-puerta.json' },
  { id: 'duelo', title: 'Duelo', path: 'duelo.json' },
  { id: 'hasta-calmar-el-alma', title: 'Hasta calmar el alma', path: 'hasta-calmar-el-alma.json' },
  { id: 'luz-y-sal', title: 'Luz y sal', path: 'luz-y-sal.json' },
  { id: 'no-te-voy-a-odiar', title: 'No te voy a odiar', path: 'no-te-voy-a-odiar.json' },
  { id: 'paso', title: 'Paso', path: 'paso.json' },
  { id: 'pimiento', title: 'Pimiento', path: 'pimiento.json' },
  { id: 'tragedia-de-cerdo-asado', title: 'Tragedia de cerdo asado', path: 'tragedia-de-cerdo-asado.json' },
  { id: 'don-bonifacio', title: 'Don Bonifacio', path: 'don-bonifacio.json' },
] as const

export type SongId = (typeof SONGS)[number]['id']
