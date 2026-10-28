# Vaktbok

**Åpne appen:** https://hami0505.github.io/Vaktbok-prototype/

Vakter fra alle arbeidsgivere på ett sted: timer, lønnsestimat, tillegg og varsel om for kort hviletid. Laget for alle som tar vakter hos flere arbeidsgivere eller via vikar- og bemanningsbyråer, for eksempel i helse, butikk, restaurant, lager og hotell.

## Bakgrunn: fra innlevering til app

Vaktbok startet som **Mandatory Assignment 3 (Vibe Coding)** ved OsloMet, høsten 2026.

- **Innlevert versjon:** taggen [`innlevering-ma3`](https://github.com/Hami0505/Vaktbok-prototype/tree/innlevering-ma3). Den har README-en med oppgavens beskrivelse av hvordan AI ble brukt og hvordan appen ble testet.
- **Etter fristen** er appen videreutviklet til en fullverdig tjeneste med konto, synk mellom enheter, offline-støtte og mer presise lønnsregler. Denne README-en beskriver den versjonen.

Videreutviklingen er gjort på samme måte som innleveringen: jeg beskrev behov og problemer fra min egen arbeidshverdag, og brukte Claude (Anthropic) til å planlegge, skrive kode og tester, og finne og rette feil. Hver endring er testet automatisk og manuelt i nettleseren før den ble tatt i bruk.

## Funksjoner

- **Vakter på tvers av arbeidsgivere** med ukevisning på en 24-timers stripe, vakter over midnatt, pause og notat. Kopier en vakt til neste dag eller uke, og angre sletting.
- **Gjentakende vakter** som i kalenderapper: hver dag, hver uke, annenhver uke, hver ukedag, eller egendefinert (hver *n*. dag eller uke på valgte ukedager), som slutter aldri, på en dato eller etter et antall ganger. Ved endring og sletting velger du «bare denne», «denne og alle senere» eller «alle i serien». Serier uten slutt fylles på automatisk ett år frem.
- **Lønnsestimat med ekte tilleggsregler** per arbeidsgiver: så mange tillegg du vil (kveld, natt, lørdag, søndag, helligdager), i kroner per time eller prosent av timelønn, med valgfrie dager og klokkeslett. Kopier tillegg fra en arbeidsgiver til en annen.
- **Norske helligdager** regnes ut automatisk, inkludert påske og pinse.
- **Overtid** per dag og/eller per uke, per arbeidsgiver, slik arbeidsmiljøloven regner det.
- **Timelønn, honorar eller frivillig** per arbeidsgiver. Honorar føres per oppdrag med et vanlig beløp som forslag, og viser hva det tilsvarer per time. Enhver vakt kan også få et avtalt fast beløp. Frivillig arbeid føres uten lønn, og kan holdes utenfor varsler om hviletid.
- **Feriepenger** (10,2 % eller 12 %), og valg mellom brutto og utbetalt (etter skattetrekk) i oversiktene. Trekk er forskudd på skatten, ikke endelig skatt.
- **Skatt per arbeidsgiver:** standard trekk, prosenttrekk, tabelltrekk (anslått fra en lønnsslipp) eller skattefri organisasjon (inntil 10 000 kr i året).
- **Frikort:** grense, inntekt utenfor Vaktbok, valg for bestilt skattekort, hvor mye som er brukt og hva planlagte vakter gir, med varsel før du går over.
- **Varsler** ved for kort hviletid (11 timer, justerbart), overlappende vakter og når samlet arbeidstid i en uke passerer en grense. Arbeidsmiljøloven gjelder per arbeidsgiver, så varsler på tvers av arbeidsgivere er for brukerens egen del, og appen sier det.
- **Oversikt** over måned og år per arbeidsgiver, med diagram over året. Hold over eller trykk på en måned for å se tallene og åpne den. Regneark (CSV for Excel), kalenderfil (.ics), timeliste til utklippstavlen og timeliste som PDF med signaturfelt.
- **Importer vakter** fra kalenderlenke (iPhone og iCloud, Google, Outlook, byråets vaktplan), kalenderfil (.ics), regneark (.csv) eller sikkerhetskopi. Hendelsene samles etter navn, så du krysser av for hva som er vakter og kobler hver gruppe til en arbeidsgiver (eller oppretter en ny). Gjentakende hendelser blir enkeltvakter, du kan velge bort enkeltvakter, setter standardpause, og dubletter hoppes over. Lagrede kalenderlenker husker valgene og kan hentes på nytt med ett trykk.
- **Sjekk mot lønnsslippen:** skriv inn utbetalt brutto og se om det stemmer med estimatet.
- **Tilbudte vakter:** merk vakter du er tilbudt, men ikke har tatt. De vises skravert og telles ikke før du trykker «Ta vakta».
- **Kalenderabonnement:** vaktene dukker opp i iPhone-, Google- eller Outlook-kalenderen av seg selv.
- **Lim inn tekst:** lim inn en SMS, e-post eller vaktliste, så finner Vaktbok datoer og klokkeslett. Det skjer i appen, så teksten sendes ingen steder.
- **Eksport** til kalenderfil (.ics) eller regneark (.csv), med valg av periode og arbeidsgiver.
- **Tilbakemeldingsskjema** i appen, og **feillogg** som viser deg feil som skjer hos brukerne.
- **Konto og synk i sanntid** mellom mobil og PC, med innlogging via engangskode på e-post. Uten konto fungerer alt lokalt i nettleseren.
- **Fungerer offline** og kan installeres på hjemskjermen. Endringer gjort uten nett sendes når nettet er tilbake.
- **Personvern:** last ned alle data, slett alt, slett konto. Appen nekter å lagre fødselsnummer og D-nummer i notater (kontrollsifre sjekkes). Ingen sporing, ingen eksterne fonter.
- **Eksempeldata:** nye, tilfeldige eksempeldata hver gang, så appen kan prøves uten egne vakter.
- **Landingsside** for nye besøkende, med «Prøv med eksempeldata» og «Start med egne vakter». Logoen tar deg tilbake til denne uka.

## Teknikk

Ren HTML, CSS og JavaScript-moduler. Ingen build-steg, så appen ligger rett på GitHub Pages.

| Fil | Innhold |
|---|---|
| `js/logic.js` | Ren beregningslogikk: lønn, tillegg, helligdager, overtid, varsler, validering, eksport |
| `js/sync-core.js` | Ren synklogikk: utboks, rekkefølge, sammenslåing med serverdata |
| `js/store.js` | Datalag: lokal lagring, utboks, synk og sanntid mot Supabase |
| `js/demo.js` | Tilfeldige eksempeldata |
| `js/importer.js` | Import fra kalenderlenke, kalenderfil, regneark og sikkerhetskopi |
| `supabase/functions/ics-proxy/` | Serverfunksjon som henter kalendere fra lenke for innloggede brukere |
| `js/app.js` | Brukergrensesnitt |
| `js/config.js` | Supabase-nøkler og kontaktadresse (offentlige verdier, tilgang styres av RLS) |
| `supabase/schema.sql` | Tabeller, tilganger, Row Level Security, sanntid og sletting av konto |
| `sw.js` | Service worker for offline-bruk |
| `tests/` | 72 automatiske tester, kjøres på hver push via GitHub Actions |

Lagring er lokal først: alle endringer lagres i nettleseren med en gang og legges i en utboks. Når brukeren er innlogget og på nett, sendes utboksen til Supabase og serverdata hentes inn. Andre enheter får beskjed i sanntid. Serveren er fasit, unntatt for endringer som ennå ikke er sendt.

## Nettlesere og plattformer

Vaktbok er en nettside som kan installeres som app (PWA). Den virker i nyere versjoner av:

| Plattform | Nettlesere | Installere som app |
|---|---|---|
| iPhone og iPad (iOS 15.4 eller nyere) | Safari, og andre nettlesere på iOS | Safari → Del → Legg til på Hjem-skjerm |
| Android | Chrome, Edge, Samsung Internet, Firefox | Meny → Installer app |
| Windows, Mac, Linux | Chrome, Edge, Firefox, Safari (Mac) | Chrome og Edge: installer-ikonet i adressefeltet |

Minstekravet kommer av at appen bruker moderne JavaScript (moduler, `dialog`, `structuredClone`, `crypto.randomUUID`), som kom i alle store nettlesere i 2022. Testet automatisk i Chromium. Internet Explorer støttes ikke.

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

### Kalenderlenker (serverfunksjon)

Nettlesere får ikke hente kalenderfiler fra andre nettsteder direkte, så import fra lenke går via en liten serverfunksjon.

1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Gi den navnet `ics-proxy`, lim inn hele `supabase/functions/ics-proxy/index.ts` og trykk **Deploy**.
3. Åpne funksjonen → **Details** (eller Settings) og slå **av** «Verify JWT» / «Enforce JWT verification». Funksjonen sjekker selv at brukeren er innlogget, og gjør det på en måte som virker med alle nøkkeltyper.
4. Bruker appen en annen adresse enn `https://hami0505.github.io`, legg den til i `ALLOWED_ORIGINS` øverst i funksjonen.

Uten funksjonen virker alt annet, og appen sier ifra hvis noen prøver å importere fra lenke.

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

## Nye serverfunksjoner

To nye funksjoner ligger i `supabase/functions/`. Deploy hver av dem i Supabase → Edge Functions → **Deploy a new function** → **Via Editor**, med samme navn som mappa, og slå av **Verify JWT** (funksjonene sjekker selv det de trenger).

| Funksjon | Hva den gjør | Hemmeligheter (Edge Functions → Secrets) |
|---|---|---|
| `calendar` | Kalenderabonnement: kalenderapper henter vaktene via en hemmelig lenke | Ingen |
| `feedback` | Tilbakemeldingsskjemaet: lagrer i tabellen `feedback` og sender e-post | `BREVO_API_KEY`, `FEEDBACK_TO`, `FEEDBACK_FROM` |

Uten `feedback` åpner skjemaet e-postprogrammet i stedet.

## Google-innlogging (valgfritt)

1. **Google Cloud Console** → APIs & Services → Credentials → *Create credentials* → *OAuth client ID* → *Web application*. Legg til `https://kvaxzvtlhbdpeicpcmbn.supabase.co/auth/v1/callback` under *Authorized redirect URIs*. Sett opp *OAuth consent screen* med appnavn, e-post og lenke til personvernerklæringen.
2. **Supabase** → Authentication → Providers → Google: lim inn Client ID og Client secret, og slå på.
3. **Supabase** → Authentication → URL Configuration: sjekk at `https://hami0505.github.io/Vaktbok-prototype/` står under *Redirect URLs*.
4. **`js/config.js`** på GitHub: endre `providers: []` til `providers: ['google']`.

## Statistikk og brukere

Brukerne oppgir navn ved første innlogging, og appen lagrer datoen de sist åpnet den (tabellen `profiles`). Navnet vises også som «Display name» under Authentication → Users.

Spørringer for antall brukere, aktive brukere og en brukerliste ligger i `supabase/admin/statistikk.sql`. Lim dem inn i SQL Editor og lagre dem der, så har du dem for hånd. De virker bare i dashbordet, ikke fra appen.

## Før flere brukere slipper til

- [x] Egen SMTP
- [x] Personvernerklæring (`personvern.html`)
- [ ] Databehandleravtale (DPA) med Supabase og Brevo
- [ ] Sjekk abonnementet hos Supabase. Gratisprosjekter settes på pause etter en uke uten aktivitet; `.github/workflows/keepalive.yml` pinger databasen hvert tredje døgn for å unngå det, men bare Pro er sikkert og gir sikkerhetskopier.
- [ ] Eget domene (valgfritt), med oppdatert Site URL i Supabase
- [ ] Øk `VERSION` i `sw.js` ved hver utgivelse, så brukerne får beskjed om ny versjon

## Begrensninger

Lønn og skatt er estimater. Tillegg regnes ut fra kalenderdagen hvert minutt faller på, og pause trekkes forholdsmessig fra alle tidsrom i vakta. Ved samtidige endringer av samme vakt på to enheter vinner den siste. Sjekk alltid mot lønnsslippen.
