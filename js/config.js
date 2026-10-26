// Fyll inn fra Supabase: Project Settings → API.
// Anon-nøkkelen er laget for å ligge i frontend-kode; tilgangen styres av Row Level Security i databasen.
// La feltene stå tomme for å kjøre appen kun lokalt (ingen innlogging eller synk).
export const config = {
  supabaseUrl: 'https://kvaxzvtlhbdpeicpcmbn.supabase.co',
  supabaseAnonKey: 'sb_publishable_-bZhQBX3CQNzXjHUBbl-DQ_LHPX6IQD',
  contactEmail: 'vaktbok.app@gmail.com', // vises i personvernerklæringen og ved feil
};
