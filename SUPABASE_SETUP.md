# Supabase és adminfelület beállítása

A weboldal két részből áll:

- a **GitHub Pages** szolgálja ki a mobilbarát weboldalt;
- a **Supabase** tárolja a védett admin-, jelszó- és fizetési adatokat, az autó- és turnusvezetői beosztásokat, valamint a nyilvánosan olvasható kontaktlistát.

A Supabase-kód forrása ugyanebben a GitHub repositoryban található. A `.github/workflows/deploy-supabase.yml` workflow a GitHubról automatikusan telepíti az adatbázis-migrációkat és az Edge Functionöket a Supabase-projektbe.

## 1. Supabase-projekt létrehozása

1. Nyisd meg a [Supabase Dashboardot](https://supabase.com/dashboard), és hozz létre egy új projektet.
2. Jegyezd fel a projekt létrehozásakor megadott adatbázis-jelszót.
3. A projektazonosító (`project ref`) a Dashboard URL-jében látható:

   ```text
   https://supabase.com/dashboard/project/PROJEKT-AZONOSITO
   ```

4. A projekt **Settings → API Keys** vagy **Connect** részén keresd meg:

   - a Project URL-t, például `https://abcdefghijkl.supabase.co`;
   - a böngészőben biztonságosan használható publishable vagy legacy anon kulcsot.

Titkos `service_role` vagy secret kulcsot soha ne tegyél a GitHub repositoryba vagy Pages-változóba.

## 2. Supabase hozzáférési token

1. Nyisd meg a Supabase-fiókod **Account → Access Tokens** oldalát.
2. Hozz létre egy tokent például `Sirok GitHub deployment` néven.
3. Másold ki rögtön; GitHub Secretként fogjuk tárolni.

## 3. Jelszó-pepper létrehozása

Hozz létre egy legalább 32 bájtos, véletlen titkot. Például OpenSSL használatával:

```bash
openssl rand -base64 48
```

Ezt csak GitHub Secretként tárold. Később ne cseréld le, mert a dolgozói jelszavak szerveroldali keresőértéke ehhez kötődik.

## 4. GitHub Secrets és Variables

Nyisd meg:

`Repository → Settings → Secrets and variables → Actions`

### Secrets

| Név | Érték |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | A Supabase account access token |
| `SUPABASE_DB_PASSWORD` | A Supabase-projekt adatbázis-jelszava |
| `SUPABASE_PASSWORD_PEPPER` | Az előző pontban generált hosszú véletlen titok |
| `SUPABASE_SERVICE_ROLE_KEY` | Kizárólag a privát GitHub Actions kontaktimporthoz használt service-role kulcs |

### Variables

| Név | Érték |
| --- | --- |
| `SUPABASE_PROJECT_REF` | A projektazonosító |
| `SUPABASE_URL` | Például `https://abcdefghijkl.supabase.co` |
| `SUPABASE_ANON_KEY` | Publishable vagy legacy anon kulcs |
| `PUBLIC_SITE_ORIGIN` | `https://paszthytamas.github.io` – útvonal nélkül |

## 5. Migrációk és Edge Functionök telepítése GitHubról

1. Nyisd meg a repository **Actions** lapját.
2. Válaszd a **Supabase backend telepítése** workflow-t.
3. Kattints: **Run workflow → Run workflow**.

A workflow a következőket végzi el:

1. összekapcsolja a repositoryt a Supabase-projekttel;
2. lefuttatja a `supabase/migrations` könyvtár migrációit;
3. beállítja a `PASSWORD_PEPPER` és `ALLOWED_ORIGIN` Edge Function titkokat;
4. telepíti az `admin-api`, `payroll-login` és a repositoryban található további Edge Functionöket.

Később a `supabase/**` fájlok `main` ágra történő módosítása ugyanezt automatikusan elindítja.

## 6. Adminfelhasználó létrehozása

1. Supabase Dashboard → **Authentication → Users**.
2. Hozz létre egy felhasználót a saját e-mail-címeddel és egy erős adminjelszóval.
3. Jelöld megerősítettnek az e-mailt, vagy használd az automatikus megerősítés lehetőségét.
4. Nyisd meg a **SQL Editor** oldalt, és futtasd az alábbit a saját e-mail-címeddel:

   ```sql
   insert into public.admin_allowlist (user_id)
   select id
   from auth.users
   where email = 'SAJAT-ADMIN-EMAIL-CIM'
   on conflict (user_id) do nothing;
   ```

Ez engedélyezi, hogy az adott Supabase Auth-felhasználó beléphessen a weboldal adminfelületére.

## 7. GitHub Pages újratelepítése

A `SUPABASE_URL` és `SUPABASE_ANON_KEY` GitHub Variables felvétele után futtasd újra a **GitHub Pages közzététel** workflow-t. Ez beépíti a böngésző számára biztonságos kapcsolatadatokat a Pages-oldalba.

## 8. Adminfelület használata

Adminoldal:

`https://paszthytamas.github.io/sirok-2026-munkainformaciok/admin/`

Az adminfelületre a 6. pontban létrehozott **admin e-mail-címmel és adminjelszóval** lehet belépni.

### Autóbeosztások

Az **Autóbeosztások** fülön:

- kiválasztható a váltási időpont és az érkezés/távozás iránya;
- automatikus utazócsoport készíthető;
- drag-and-drop módszerrel módosítható a csoport;
- kijelölhető a sofőr;
- megadható a sofőr adott útra járó utazási díja.

### Turnusvezetők

A **Turnusvezetők** fülön minden turnushoz az adott turnusban dolgozók közül választható vezető.

Közvetlen cím:

`https://paszthytamas.github.io/sirok-2026-munkainformaciok/admin/#leaders`

### Dolgozói fizetési jelszavak

A jelszó nem a Supabase Dashboardban olvasható lista, hanem az adminoldalon állítható be személyenként:

1. nyisd meg az adminoldalt, és lépj be az admin e-mail-címeddel és adminjelszavaddal;
2. nyisd meg a **Fizetések** fület, vagy közvetlenül az `/admin/#payroll` címet;
3. a **Dolgozó** mezőben válaszd ki azt, akinek jelszót adsz;
4. kattints az **Erős jelszó generálása** gombra, vagy írj be egy egyedi, legalább 12 karakteres jelszót;
5. a **Másolás** gombbal másold ki, és még mentés előtt add át biztonságos csatornán a dolgozónak;
6. kattints a **Jelszó beállítása** gombra;
7. a dolgozó a nyilvános oldal **Fizetésem** menüpontjában kizárólag ezt a jelszót írja be; külön felhasználónév nem szükséges.

A már elmentett jelszó **nem olvasható vissza**. Az adatbázis csak sózott jelszókivonatot tárol. Az admin azt látja, hogy van-e jelszó beállítva. Elfelejtett jelszó esetén újat kell beállítani.

### Költségösszesítő

A **Költségösszesítő** fülön személyenként látható a munkadíj, az utazási díj és a teljes fizetendő összeg, valamint felül az összes kiadás. Az utazási díjak utanként, a sofőr neve alatt szerkeszthetők. A 0 Ft-os, még kitöltetlen sofőrös utakat sárga jelölés mutatja. Ugyanez a díj az **Autóbeosztások** fül adott autójánál is módosítható.

## 9. Nyilvános kontaktlista feltöltése

1. Töltsd le és nyisd meg a `data/Sirok 2026 kontaktok - sablon.xlsx` fájlt.
2. A neveket ne módosítsd; töltsd ki a `Telefonszám` oszlopot szövegként, lehetőleg `+36301234567` formában.
3. Mentsd `Sirok 2026 kontaktok.xlsx` néven.
4. Töltsd fel a privát repository `data` könyvtárába.
5. A feltöltés automatikusan elindítja a **Kontaktlista szinkronizálása** workflow-t. Szükség esetén az Actions oldalról kézzel is futtatható.

A telefonszámok nem kerülnek a GitHub Pages statikus fájljaiba. A workflow a `SUPABASE_SERVICE_ROLE_KEY` secret segítségével frissíti a `worker_contacts` táblát. Ezt a kulcsot soha ne add meg GitHub Variable-ként, ne írd fájlba, és ne építsd be a weboldalba.

A `202607220004_public_worker_contacts.sql` migráció után a tábla olvasása nyilvános, de a látogatók nem írhatják és nem törölhetik az adatokat. A **Kontaktlista**, az **Autóbeosztás** és a **Dolgozói adatlap** nevei ezután jelszó nélkül közvetlen telefonhivatkozássá válnak.

## 10. Gyors hibakeresés

- **Az adminoldal csak helyi előkészítő módot mutat:** nincs beépítve a `SUPABASE_URL` vagy `SUPABASE_ANON_KEY`; futtasd újra a Pages workflow-t.
- **Az admin belépés sikertelen:** ellenőrizd az Auth-felhasználót és az `admin_allowlist` rekordot.
- **Hiányzik a `shift_leaders` tábla:** futtasd a Supabase backend workflow-t, hogy a migrációk települjenek.
- **CORS-hiba:** a `PUBLIC_SITE_ORIGIN` pontosan `https://paszthytamas.github.io` legyen, lezáró perjel és repository-útvonal nélkül.
- **A dolgozói fizetési belépés nem működik:** ellenőrizd, hogy a `PASSWORD_PEPPER` beállt-e, és a `payroll-login` függvény települt-e.
- **A kontaktlista üres:** ellenőrizd a `202607220004_public_worker_contacts.sql` migrációt és a **Kontaktlista szinkronizálása** workflow eredményét.

Hivatalos dokumentáció:

- https://supabase.com/docs/guides/functions/examples/github-actions
- https://supabase.com/docs/guides/functions/deploy
- https://supabase.com/docs/reference/cli/introduction
- https://supabase.com/docs/guides/functions/secrets
