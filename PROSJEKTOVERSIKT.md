# Vaktbok – prosjektoversikt

Grunnmuren for videre arbeid. Oppdatert 30. oktober 2026. Når noe her endres, oppdater dette dokumentet.

## 1. Hva Vaktbok er

Vaktbok samler vakter fra flere arbeidsgivere på ett sted: ukestripe, timer, lønnsestimat med tillegg, overtid, feriepenger og skatt, og varsler om hviletid. Laget for alle som har vakter hos flere arbeidsgivere, uansett bransje: vikarbyrå, helse, servering, butikk, lager og annet.

Startet som Mandatory Assignment 3 (Vibe Coding) ved OsloMet, og videreutviklet til en ekte, gratis webapp (PWA) som kan legges til på Hjem-skjermen.

**Kriterier for alt arbeid:**
- **Gratis.** Ingen betalte tjenester. Bruk gratisnivåene til GitHub Pages, Supabase og Brevo.
- **Ekte og human, ikke AI-preg.** Kort, klart norsk. Ingen generiske dashbord-mønstre.
- **Reell problemløser.** Bygg det som løser faktiske problemer i vaktarbeid, ikke funksjoner for sin egen skyld.
- **Enkel, men komplett.** Avanserte valg skjules til de trengs (for eksempel «Flere valg»).
- **Personvern først.** Minst mulig data, ingenting om andre personer, ærlig personvernerklæring.
- **God UX/UI på mobil og PC**, med kontrast etter WCAG (tekst 4,5 : 1, kanter 3 : 1).

## 2. Adresser og kontoer

| Hva | Verdi |
|---|---|
| App | https://hami0505.github.io/vaktbok/ |
| Kode | https://github.com/Hami0505/vaktbok (gamle `Vaktbok-prototype` sender videre) |
| Innlevert versjon | taggen `innlevering-ma3` |
| Supabase | prosjekt `kvaxzvtlhbdpeicpcmbn`, region EU West (Irland), gratisplan |
| E-post | `vaktbok.app@gmail.com` (kontakt, avsender for koder og tilbakemeldinger, eier Google Cloud-prosjektet `vaktbok`) |
| SMTP / e-post-API | Brevo, gratisplan |
| Administrator | `haaz2305@gmail.com` (i tabellen `admins`) |
| Ansvarlig i personvernerklæringen | Hamza Aziz |
| Lokalt | `~/Intro til KI/Vaktbok` |

## 3. Arkitektur

```
Nettleser (PWA, lokal-først)
├── index.html + css/app.css          statisk, ingen byggesteg
├── js/app.js                         oppstart, faner, felles handlinger
│   ├── js/ui/*.js                    én modul per visning
│   ├── js/logic.js                   all beregning (ren, testbar)
│   └── js/store.js                   data: localStorage + synk mot Supabase
│        └── js/sync-core.js          ren synklogikk (utboks, sammenslåing)
├── sw.js                             service worker: virker uten nett
└── localStorage                      alle data lagres lokalt først

GitHub Pages ──── serverer appen (gratis, HTTPS)

Supabase (EU)
├── Auth                              e-postkode (OTP) og Google
├── Postgres + RLS                    hver bruker ser bare sine egne rader
├── Realtime                          synk mellom enheter + «inne nå»
└── Edge Functions                    calendar, feedback, ics-proxy

Brevo ─────────── sender innloggingskoder og tilbakemeldinger på e-post
GitHub Actions ── tester ved push, keepalive hvert 3. døgn
```

**Prinsipper:**
- **Lokal-først:** alt skrives til localStorage med en gang, og legges i en utboks som synkes når det er nett. Appen virker uten konto (gjestemodus) og uten nett.
- **Ingen byggesteg:** ES-moduler lastes direkte. Oppstartsfilene forhåndslastes (`modulepreload`), og sjeldne deler lastes ved behov (`import()`).
- **Sikkerheten ligger i databasen,** ikke i appen: RLS på alle tabeller, og funksjoner med `security definer` sjekker selv tilgang.
- **Første tegning uten layoutskift:** `html.booting` skjuler hovedinnholdet til appen har tegnet, og appen starter med sist innloggede brukers lokale data.

## 4. Filstruktur

```
vaktbok/
├── index.html                  hele grensesnittet (visninger og vinduer)
├── personvern.html             personvernerklæring (OVERSKRIVES IKKE av vaktbok-oppdater)
├── manifest.webmanifest        PWA
├── sw.js                       service worker, VERSION økes ved hver utgivelse
├── css/app.css                 alle stiler, i lag (se innholdsfortegnelsen øverst)
├── fonts/                      Schibsted Grotesk 400/500/700/800, selv-hostet + OFL.txt
├── icons/                      icon.svg, icon-192.png, icon-512.png
├── js/
│   ├── app.js                  oppstart, setTab, render, actions, landingsside, bannere
│   ├── config.js               Supabase-nøkler, contactEmail, providers, googleClientId (OVERSKRIVES IKKE)
│   ├── logic.js                beregning: lønn, tillegg, overtid, skatt, frikort, varsler,
│   │                           serier, import/eksport-formater, tekstgjenkjenning
│   ├── store.js                Store-klassen: lagring, synk, auth, profil, sanntid, serverkall
│   ├── sync-core.js            utboks og sammenslåing (ren logikk)
│   ├── importer.js             importvinduet: lenke, .ics, .csv, .json, lim inn tekst (lastes ved behov)
│   ├── demo.js                 eksempeldata (lastes ved behov)
│   ├── pdf.js                  timeliste som PDF med jsPDF (lastes ved behov)
│   ├── personvern.js           fyller inn kontaktadresse på personvernsiden
│   └── ui/
│       ├── core.js             felles: $, esc, kr, fmtDay, store, ui, D(), toast, confirmBox,
│       │                       choiceBox, warningText, fgFor/readableBg, vinduslåsing
│       ├── week.js             Uke: stripa, vaktlista, ukesum, «Kom i gang»
│       ├── shift.js            vaktvinduet, gjentakende vakter, kopiering
│       ├── employers.js        arbeidsgivere, tillegg, lønnsform, skatt, «Flere valg»
│       ├── overview.js         Oversikt: måned, år, frikort, lønnsslipp, timeliste
│       ├── account.js          Konto: innlogging, navn, innstillinger, kalenderlenke, data
│       ├── errors.js           feillogg til client_errors (lastes først)
│       ├── export.js           eksportvinduet (lastes ved behov)
│       ├── feedback.js         tilbakemeldingsskjema (lastes ved behov)
│       └── admin.js            statistikkside, bare administrator (lastes ved behov)
├── supabase/
│   ├── schema.sql              HELE databasen, kilde til sannhet for nye prosjekter
│   ├── migrations/             engangsendringer i kjørerekkefølge (historikk)
│   ├── admin/statistikk.sql    spørringer for SQL Editor
│   └── functions/
│       ├── calendar/index.ts   kalenderabonnement (.ics via hemmelig lenke)
│       ├── feedback/index.ts   tilbakemelding → tabell + e-post via Brevo
│       └── ics-proxy/index.ts  henter kalenderlenker for import (unngår CORS)
├── scripts/
│   ├── vaktbok-oppdater.zsh    funksjonen som legges i ~/.zshrc
│   └── vaktbok-backup.sh       sikkerhetskopi av databasen til Macen
├── tests/                      logic, store, sync, functions (83 tester, node --test)
│   └── e2e/app.spec.js         grensesnittet med Playwright og axe (npm run e2e)
├── playwright.config.js        390, 320 og 1280 piksler, lys og mørk modus
├── .github/workflows/          test.yml, keepalive.yml
└── README.md                   for brukere og utviklere
```

## 5. Datamodell (i appen)

```js
// Arbeidsgiver
{
  id, name, color, archived,
  rate,                                   // kr per time
  rules: [{ id, label, kind: 'kr' | 'pct', value, days: [0..6], from: 'HH:MM', to: 'HH:MM', holiday }],
  overtime: { afterH, weekH, pct } | null,
  pay: {                                  // null = vanlig timelønn uten eget skattevalg
    type: 'hourly' | 'fee' | 'volunteer',
    feeDefault, holidayPay, inWarnings,
    tax: { mode: 'default' | 'pct' | 'table' | 'freeOrg', pct, slipGross, slipTax },
  },
}

// Vakt
{
  id, employerId, date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM',   // end <= start = over midnatt
  breakMin, note,                        // notat: maks 200 tegn, fødselsnummer stoppes
  fee,                                   // fast beløp for denne vakta, overstyrer alt
  seriesId,                              // gjentakende vakt
  status: null | 'offered',              // tilbudt = vises, men telles ikke
}

// Innstillinger (DEFAULT_SETTINGS i logic.js)
{
  holidayPayPct: 10.2, minRestH: 11, weekLimitH: 48, taxPct: 0,
  frikort: { on, limit: 100000, otherIncome, newCardPct } | null,
  payslips: { 'YYYY-MM': { employerId: brutto } },
  calendarLinks: [...],                  // lagrede kalenderlenker for import
}
```

**Viktige regler i beregningen:** tillegg regnes minutt for minutt etter kalenderdag og helligdag (norske helligdager beregnes). Pause trekkes forholdsmessig. Ukeovertid per arbeidsgiver og ISO-uke. Skatt per vakt: frikort (0 % til grensen, så 50 % eller nytt kort), skattefri organisasjon (10 000 kr/år, ellers alt skattepliktig), tabelltrekk (ingen trekk i juni, halvt i desember). «Utbetalt» er etter trekk, ikke endelig skatt.

## 6. Database (Supabase)

```sql
-- Tabeller (alle med RLS)
employers       (id, user_id, name, rate, color, rules jsonb, overtime jsonb, pay jsonb, archived, ...)
shifts          (id, user_id, employer_id, date, start_time, end_time, break_min, note, fee, series_id, status, ...)
settings        (user_id, data jsonb)
profiles        (user_id, display_name, last_seen date)           -- navn og «sist aktiv» (dato)
calendar_feeds  (user_id, token)                                   -- kalenderabonnement
feedback        (id, created_at, user_id, email, kind, message, meta)   -- skrives bare av serverfunksjonen
client_errors   (id, created_at, user_id, message, source, line, stack, version, browser, page)  -- alle kan skrive, ingen lese
admins          (user_id)                                          -- hvem som ser statistikken

-- Funksjoner
touch_updated_at()   delete_my_account()   keepalive()
is_admin()           admin_stats()        -- security definer, avslår alle som ikke er i admins

-- Tilgang: authenticated eier egne rader via RLS. service_role får eksplisitt grant
-- (nyere prosjekter gir det ikke automatisk). anon kan bare skrive til client_errors.
```

**Endre databasen:** lag ny fil i `supabase/migrations/` med dato, kjør i SQL Editor, og legg det samme inn i `schema.sql`. Alt skal kunne kjøres flere ganger (`if not exists`, `drop policy if exists`).

## 7. Modulene og de viktigste funksjonene

```
logic.js (ren, ingen DOM)
  Dato:       isoDate parseDate parseShift mondayOf isoWeek norwegianHolidays holidayName
  Lønn:       calcShift calcAll calcAllNet payType givesHolidayPay hasFixedFee ruleMatches
  Skatt:      taxPctFor applyTax frikortStatus FREE_ORG_LIMIT FRIKORT_DEFAULT
  Status:     isOffered counted
  Varsler:    checkRest restWarnings weeklyOverLimit countsForWarnings
  Validering: validateShift validateEmployer isNorwegianId noteLooksSensitive
  Serier:     seriesDates describeRepeat validateRepeat SERIES_HORIZON_DAYS
  Oversikt:   shiftsInMonth monthSummary yearSummary payslipDiff
  Eksport:    selectForExport toCSV toTimesheet toICS
  Import:     parseICS expandEvents icsToShifts parseCSV guessColumns csvToShifts
              parseShiftText textToRows (lim inn tekst, lokalt) migrateV
  Feillogg:   cleanError

store.js (Store extends EventTarget, events: change, status, profile, presence)
  Data:       upsertEmployer deleteEmployer upsertShift deleteShift updateSettings addAll exportAll
  Synk:       init sync flush pull subscribe useScope
  Konto:      sendCode verifyCode signInWithIdToken signInWithProvider signOut deleteEverything deleteAccount
  Profil:     loadProfile setDisplayName
  Server:     fetchCalendar (ics-proxy) getFeed newFeed deleteFeed feedUrl (calendar)
              sendFeedback (feedback) isAdmin adminStats
  Sanntid:    joinPresence trackPresence (fast tilfeldig ID per enhet, bare «innlogget ja/nei»)
```

## 8. Serverfunksjoner

| Funksjon | Hva | Verify JWT | Hemmeligheter |
|---|---|---|---|
| `calendar` | `?t=<48 hex>` gir .ics med vakter 60 dager bak til 400 dager frem. Aldri notater. Tilbudte = TENTATIVE | Av | – |
| `feedback` | Lagrer i `feedback`, sender e-post via Brevo, robotfelle, 5 per 10 min per IP | Av | `BREVO_API_KEY`, `FEEDBACK_TO`, `FEEDBACK_FROM` |
| `ics-proxy` | Henter kalenderlenker for import | Av | – |

Funksjonene bruker `serviceHeaders()`, som støtter både nye (`SUPABASE_SECRET_KEYS`, `sb_secret_…`) og gamle (`SUPABASE_SERVICE_ROLE_KEY`) nøkler, og logger feil med `console.error`. Tillatte opphav: `https://hami0505.github.io` og `http://localhost:5173`.

**Deploy:** Edge Functions → funksjonen → Code → lim inn → Deploy. Navnet må stemme nøyaktig.

## 9. Arbeidsflyt

```bash
# Kjøre lokalt
npm start                 # http://localhost:5173
npm test                  # 83 tester
npm run e2e               # Playwright (første gang: npm install && npx playwright install chromium)

# Oppdatere fra Claude: last ned vaktbok.zip, så
vaktbok-oppdater "Beskrivelse"
# kopierer alt unntatt js/config.js og personvern.html, sletter fjernede filer,
# kjører testene, viser endringene og spør før push.
# Ny personvernerklæring kopieres for hånd:
cp /tmp/vaktbok-ny/vaktbok/personvern.html . && git add personvern.html && git commit -m "Personvern" && git push

# Sikkerhetskopi (første gang: brew install libpq, så vaktbok-backup oppsett)
vaktbok-backup            # til ~/Documents/Vaktbok-backup, beholder 12
```

**Ved hver utgivelse:** øk `VERSION` i `sw.js` og `<meta name="vaktbok-version">` i `index.html`.

**Testing:** `npm test` for logikk, datalag, synk og serverfunksjoner. `npm run e2e` tester grensesnittet med Playwright i Chromium (390, 320 og 1280 piksler, lys og mørk modus) og axe for tilgjengelighet. Begge kjører i GitHub Actions ved hver push. Lighthouse kjøres for hånd. Safari og iPhone testes for hånd.

**Hemmeligheter** (API-nøkler, passord, kalenderlenker) skal aldri i chat, skjermbilder eller kode. Ligger noe ute, lag nytt.

## 10. Beslutninger som er tatt

- **Ingen AI i appen:** «Lim inn tekst» kjører lokalt med `parseShiftText`. Gratis, privat og virker uten nett.
- **Ingen betalte tjenester:** ikke Supabase Pro, ikke eget domene, ikke SMS-innlogging.
- **Innlogging:** e-postkode uten passord, og Google. Med `googleClientId` i config.js brukes Googles egen knapp (Google Identity Services + `signInWithIdToken`), så Google-vinduet viser `hami0505.github.io` i stedet for Supabase-adressen. Skriptet lastes bare når innloggingen vises. Feiler det, brukes vanlig omdirigering via Supabase. Ingen logo i Google Branding, siden det krever verifisering.
- **Statistikk:** egen side for administrator. «Inne nå» teller enheter og hvor mange som er innlogget, aldri hvem. Sist aktiv lagres som dato, ikke klokkeslett.
- **Feillogg i egen tabell** i stedet for Sentry (gratis, blir i EU).
- **Tilbudte vakter** telles ikke i lønn, frikort, eksport eller varsler.
- **Samtidige endringer på to enheter:** hver rad husker serverversjonen (`updated_at`) den bygger på, og endringer sendes betinget. Har en annen enhet endret raden, slås endringene sammen felt for felt. Endret begge samme felt, vinner den som kom først til serveren, og brukeren får beskjed. Slettet på en annen enhet vinner over en endring. Innstillinger slås sammen per del (for eksempel per lønnsslipp). Ingen databaseendring trengs.
- **Arbeidsmiljøloven gjelder per arbeidsgiver:** varsler på tvers av arbeidsgivere sier at de er for brukerens egen del.
- **Eksport** til .ics og .csv med periode og arbeidsgiver. Timeliste som PDF (delingsark på mobil, ny fane på PC).
- **Repoet heter `vaktbok`.** Den gamle adressen sender videre via repoet `Vaktbok-prototype`.

## 11. Gjenstår

1. **Teste synk for hånd før LinkedIn-innlegget:** samme vakt endret på iPhone (flymodus) og Mac, både i ulike felt (begge beholdes) og samme felt (beskjed på iPhone).
2. **Teste gjestebanneret i Safari på iPhone:** uten innlogging, med en vakt, skal det nevne Hjem-skjermen.
3. **Beta med 3–5 kolleger**, og rette det de finner.
4. **Skrive CSS-en om** fra lag til én samlet beskrivelse. Playwright-testene sjekker nå at ingen visning kan scrolles sidelengs.
5. **Systematisk testing i Safari og på iPhone**, også Google-knappen.

Ferdig 30. oktober: sammenslåing av samtidige endringer på to enheter, varig lagring og påminnelse om Hjem-skjermen for gjester i Safari, Playwright og axe i GitHub Actions, rettet bunnlenker som gjorde siden for bred på 320 piksler, spørring 6 i `statistikk.sql` uten rå nettlesertekst.

Ferdig 29. oktober: sikkerhetskopi satt opp (`vaktbok-backup`, alias i `~/.zshrc`, adressen i nøkkelringen) og Google-innlogging publisert.

**Vedlikehold:** Ta sikkerhetskopi med `vaktbok-backup` første dag hver måned. Brevo-nøkkelen utløper etter 90 dager uten bruk. Feilloggen ryddes hvert halvår (spørring nederst i `statistikk.sql`). Sjekk at keepalive kjører grønt under Actions.
