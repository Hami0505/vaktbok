# Vaktbok

**Åpne appen:** https://hami0505.github.io/Vaktbok-prototype/

Vakter fra alle arbeidsgivere på ett sted: timer, lønnsestimat, tillegg og varsel om for kort hviletid. Laget for folk i helse, omsorg og barnevern som tar vakter hos flere arbeidsgivere og via bemanningsbyråer.

## Bakgrunn: fra innlevering til app

Vaktbok startet som **Mandatory Assignment 3 (Vibe Coding)** ved OsloMet, høsten 2026.

- **Innlevert versjon:** taggen [`innlevering-ma3`](https://github.com/Hami0505/Vaktbok-prototype/tree/innlevering-ma3). Den har README-en med oppgavens beskrivelse av hvordan AI ble brukt og hvordan appen ble testet.
- **Etter fristen** er appen videreutviklet til en fullverdig tjeneste med konto, synk mellom enheter, offline-støtte og mer presise lønnsregler. Denne README-en beskriver den versjonen.

Videreutviklingen er gjort på samme måte som innleveringen: jeg beskrev behov og problemer fra min egen arbeidshverdag, og brukte Claude (Anthropic) til å planlegge, skrive kode og tester, og finne og rette feil. Hver endring er testet automatisk og manuelt i nettleseren før den ble tatt i bruk.

## Funksjoner

- **Vakter på tvers av arbeidsgivere** med ukevisning på en 24-timers stripe, vakter over midnatt, pause og notat. Kopier en vakt til neste dag eller uke, og angre sletting.
- **Lønnsestimat med ekte tilleggsregler** per arbeidsgiver: så mange tillegg du vil (kveld, natt, lørdag, søndag, helligdager), i kroner per time eller prosent av timelønn, med valgfrie dager og klokkeslett. Kopier tillegg fra en arbeidsgiver til en annen.
- **Norske helligdager** regnes ut automatisk, inkludert påske og pinse.
- **Overtid** per dag og/eller per uke, per arbeidsgiver, slik arbeidsmiljøloven regner det.
- **Feriepenger** (10,2 % eller 12 %) og valgfritt netto-estimat fra skatteprosenten.
- **Varsler** ved for kort hviletid (11 timer, justerbart), overlappende vakter og når samlet arbeidstid i en uke passerer en grense.
- **Månedsoversikt** per arbeidsgiver, regneark (CSV for Excel), kalenderfil (.ics) og timeliste til utklippstavlen.
- **Sjekk mot lønnsslippen:** skriv inn utbetalt brutto og se om det stemmer med estimatet.
- **Konto og synk i sanntid** mellom mobil og PC, med innlogging via engangskode på e-post. Uten konto fungerer alt lokalt i nettleseren.
- **Fungerer offline** og kan installeres på hjemskjermen. Endringer gjort uten nett sendes når nettet er tilbake.
- **Personvern:** last ned alle data, slett alt, slett konto. Appen nekter å lagre fødselsnummer og D-nummer i notater (kontrollsifre sjekkes). Ingen sporing, ingen eksterne fonter.
- **Eksempeldata:** nye, tilfeldige eksempeldata hver gang, så appen kan prøves uten egne vakter.

## Teknikk

Ren HTML, CSS og JavaScript-moduler. Ingen build-steg, så appen ligger rett på GitHub Pages.

| Fil | Innhold |
|---|---|
| `js/logic.js` | Ren beregningslogikk: lønn, tillegg, helligdager, overtid, varsler, validering, eksport |
| `js/sync-core.js` | Ren synklogikk: utboks, rekkefølge, sammenslåing med serverdata |
| `js/store.js` | Datalag: lokal lagring, utboks, synk og sanntid mot Supabase |
| `js/demo.js` | Tilfeldige eksempeldata |
| `js/app.js` | Brukergrensesnitt |
| `js/config.js` | Supabase-nøkler og kontaktadresse (offentlige verdier, tilgang styres av RLS) |
| `supabase/schema.sql` | Tabeller, tilganger, Row Level Security, sanntid og sletting av konto |
| `sw.js` | Service worker for offline-bruk |
| `tests/` | 36 automatiske tester, kjøres på hver push via GitHub Actions |

Lagring er lokal først: alle endringer lagres i nettleseren med en gang og legges i en utboks. Når brukeren er innlogget og på nett, sendes utboksen til Supabase og serverdata hentes inn. Andre enheter får beskjed i sanntid. Serveren er fasit, unntatt for endringer som ennå ikke er sendt.

## Kjøre lokalt

Krever Node.js 22 eller nyere for testene.

```bash
npm start      # serverer appen på http://localhost:5173
npm test       # kjører testene
```

Med tomme felt i `js/config.js` kjører appen uten server, bare med lokal lagring.

## Sette opp egen server

### Supabase (database og innlogging)

1. Opprett et prosjekt på [supabase.com](https://supabase.com) i en EU-region. Under oppretting: la **Enable Data API** være på, slå **Automatically expose new tables** av, og slå **Enable automatic RLS** på.
2. **SQL Editor**: lim inn hele `supabase/schema.sql` og kjør.
3. **Authentication → URL Configuration**: sett **Site URL** til adressen appen ligger på, og legg den samme adressen og `http://localhost:5173` til under **Redirect URLs**.
4. **Connect** (øverst) eller **Project Settings → API**: kopier Project URL og publishable/anon-nøkkelen inn i `js/config.js`. Bruk aldri `service_role`- eller secret-nøkkelen.

### E-post (SMTP)

Uten egen SMTP sender Supabase bare noen få e-poster i timen, og bare med innloggingslenke. Lenken virker kun i samme nettleser som den ble bestilt fra. Med egen SMTP kan malene få en kode som virker overalt, også i appen på hjemskjermen.

1. Lag konto hos en e-posttjeneste, for eksempel [Brevo](https://www.brevo.com) (gratisnivå). Legg til og bekreft en avsender, og lag en SMTP-nøkkel.
2. **Authentication → Emails → SMTP Settings** i Supabase: slå på custom SMTP og fyll inn avsender, server, port, brukernavn og nøkkel.
3. **Authentication → Emails → Templates**: legg `{{ .Token }}` inn i malene **Magic link or OTP** og **Confirm sign up**, for eksempel:
   ```html
   <h2>Logg inn i Vaktbok</h2>
   <p>Koden din er <strong>{{ .Token }}</strong></p>
   <p>Eller trykk her: <a href="{{ .ConfirmationURL }}">Logg inn</a></p>
   ```

Sendes e-postene fra en Gmail-adresse, kan de havne i søppelpost. Et eget domene som er bekreftet hos e-posttjenesten løser det.

## Før flere brukere slipper til

- [x] Egen SMTP
- [x] Personvernerklæring (`personvern.html`)
- [ ] Databehandleravtale (DPA) med Supabase og Brevo
- [ ] Sjekk abonnementet hos Supabase (pause ved inaktivitet, sikkerhetskopier)
- [ ] Eget domene (valgfritt), med oppdatert Site URL i Supabase
- [ ] Øk `VERSION` i `sw.js` ved hver utgivelse, så brukerne får beskjed om ny versjon

## Begrensninger

Lønn er et estimat før skatt. Tillegg regnes ut fra kalenderdagen hvert minutt faller på, og pause trekkes forholdsmessig fra alle tidsrom i vakta. Ved samtidige endringer av samme vakt på to enheter vinner den siste. Sjekk alltid mot lønnsslippen.
