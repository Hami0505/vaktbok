# Migrasjoner

Endringer i databasen, i den rekkefølgen de ble kjørt i Supabase. `../schema.sql` inneholder alt samlet
og er det som brukes for et nytt prosjekt. Filene her er historikk, og kan trygt kjøres på nytt.

| Fil | Innhold |
|---|---|
| `2026-10-28-funksjoner.sql` | Gjentakende vakter, honorar, profiler, tilbudte vakter, kalenderlenker, tilbakemeldinger, feillogg, tilganger for serverfunksjonene |
| `2026-10-28-statistikk.sql` | Administrator og statistikkfunksjonen `admin_stats()` |

Ny endring: lag en ny fil med dato i navnet, kjør den i SQL Editor, og legg det samme inn i `schema.sql`.
