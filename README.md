# Vaktbok

Vakter fra alle arbeidsgivere på ett sted: timer, lønnsestimat, tillegg og varsel om for kort hviletid. Laget for folk i helse, omsorg og barnevern som tar vakter hos flere arbeidsgivere og via bemanningsbyråer.

## Funksjoner

- **Vakter på tvers av arbeidsgivere** med ukevisning på en 24-timers stripe, vakter over midnatt, pause og notat. Kopier en vakt til neste dag eller uke.
- **Lønnsestimat med ekte tilleggsregler** per arbeidsgiver: så mange tillegg du vil (kveld, natt, lørdag, søndag, helligdager), i kroner per time eller prosent av timelønn, med valgfrie dager og klokkeslett. Norske helligdager, inkludert påske og pinse, regnes ut automatisk. Overtid per dag og/eller per uke (per arbeidsgiver, som i arbeidsmiljøloven). Feriepenger (10,2 % eller 12 %) og valgfritt netto-estimat fra skatteprosenten.
- **Varsler** når hviletiden mellom vakter er kortere enn 11 timer (justerbart), når vakter overlapper, og når samlet arbeidstid i en uke passerer en grense.
- **Månedsoversikt** per arbeidsgiver, regneark (CSV for Excel), kalenderfil (.ics) og timeliste til utklippstavlen.
- **Sjekk mot lønnsslippen:** skriv inn utbetalt brutto og se om det stemmer med estimatet.
- **Kopier tillegg** fra en arbeidsgiver til en annen, og **angre** sletting av vakter og arbeidsgivere.
- **Konto og synk i sanntid** mellom mobil og PC, med innlogging via engangskode på e-post. Uten konto fungerer alt lokalt.
- **Fungerer offline** og kan installeres på hjemskjermen. Endringer gjort uten nett sendes når nettet er tilbake.
- **Personvern:** last ned alle data, slett alt, slett konto. Varsel hvis notatfeltet ser ut til å inneholde et fødselsnummer. Ingen sporing, ingen eksterne fonter.
- **Import** fra prototypen (Vaktbok-prototype) tilbys automatisk hvis den har data i samme nettleser.

## Teknikk

Ren HTML, CSS og JavaScript-moduler. Ingen build-steg, så appen kan ligge rett på GitHub Pages.

| Fil | Innhold |
|---|---|
| `js/logic.js` | Ren beregningslogikk: lønn, tillegg, helligdager, varsler, validering, eksport |
| `js/sync-core.js` | Ren synklogikk: utboks, rekkefølge, sammenslåing med serverdata |
| `js/store.js` | Datalag: lokal lagring, utboks og synk mot Supabase |
| `js/app.js` | Brukergrensesnitt |
| `js/config.js` | Supabase-nøkler (offentlige, tilgang styres av RLS) |
| `supabase/schema.sql` | Tabeller, Row Level Security og sletting av konto |
| `sw.js` | Service worker for offline-bruk |
| `tests/` | 35 automatiske tester (`npm test`), kjøres på hver push via GitHub Actions |

Lagring er lokal først: alle endringer lagres i nettleseren med en gang og legges i en utboks. Når du er innlogget og på nett, sendes utboksen til Supabase og serverdata hentes inn. Serveren er fasit, unntatt for endringer som ennå ikke er sendt.

## Oppsett

### 1. Supabase

1. Opprett et prosjekt på [supabase.com](https://supabase.com). Velg en region i EU.
2. Åpne **SQL Editor**, lim inn hele `supabase/schema.sql` og kjør.
3. Under **Authentication → Sign In / Providers**: sjekk at **Email** er på.
4. Under **Authentication → Emails → Magic Link**: legg til koden i malen, for eksempel:
   ```html
   <h2>Logg inn i Vaktbok</h2>
   <p>Koden din er <strong>{{ .Token }}</strong></p>
   <p>Eller trykk her: <a href="{{ .ConfirmationURL }}">Logg inn</a></p>
   ```
   Gjør det samme i **Confirm signup**-malen. Koden er viktig fordi lenker fra e-post på iPhone åpnes i Safari og ikke i appen på hjemskjermen.
5. Under **Authentication → URL Configuration**: sett **Site URL** til adressen appen ligger på (for eksempel `https://hami0505.github.io/Vaktbok-prototype/`) og legg samme adresse til under **Redirect URLs**.
6. Under **Project Settings → API**: kopier **Project URL** og **anon public key** inn i `js/config.js`.

### 2. GitHub Pages

1. Kopier filene inn i roten av repoet (`Vaktbok-prototype`). Slett de gamle `logic.js` og `test.js` i roten.
2. **Settings → Pages**: velg **Deploy from a branch**, `main` og `/ (root)`.

### 3. Lokalt

```bash
npm start      # serverer appen på http://localhost:5173
npm test       # kjører testene
```

Med tomme felt i `js/config.js` kjører appen uten server, bare med lokal lagring.

## Før ekte brukere slipper til

- [ ] **Egen e-posttjeneste (SMTP).** Supabase sin innebygde e-post er bare for testing og har en lav grense på antall e-poster i timen. Sett opp SMTP under **Authentication → Emails → SMTP Settings** med en leverandør som Resend, Brevo eller Postmark.
- [ ] **Fyll inn personvernerklæringen** (`personvern.html`): navn eller firmanavn og kontakt-e-post.
- [ ] **Databehandleravtale (DPA)** med Supabase. Den kan signeres fra Supabase-dashbordet.
- [ ] **Abonnement og sikkerhetskopier.** Sjekk vilkårene for gratisnivået hos Supabase (blant annet om inaktive prosjekter settes på pause og hvilke sikkerhetskopier som er inkludert). For betalende eller mange brukere bør prosjektet ligge på et betalt nivå.
- [ ] **Eget domene** (valgfritt), for eksempel `vaktbok.no`, satt opp under Settings → Pages. Husk å oppdatere Site URL i Supabase.
- [ ] **Øk `VERSION` i `sw.js`** ved hver utgivelse, så får brukerne beskjed om at en ny versjon er klar.

## Begrensninger

Lønn er et estimat før skatt. Tillegg regnes ut fra kalenderdagen hvert minutt faller på, og pause trekkes forholdsmessig fra alle tidsrom i vakta. Ved samtidige endringer av samme vakt på to enheter vinner den siste. Sjekk alltid mot lønnsslippen.
