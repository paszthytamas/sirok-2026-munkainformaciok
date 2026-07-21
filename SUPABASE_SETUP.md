# Supabase és adminfelület beállítása

A weboldal két részből áll:

- a **GitHub Pages** szolgálja ki a mobilbarát weboldalt;
- a **Supabase** tárolja a védett admin-, jelszó-, fizetési, autó- és turnusvezetői adatokat, valamint futtatja a szerveroldali ellenőrzést.

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
4. telepíti az `admin-api` és `payroll-login` Edge Functionöket.

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
- megadható a sofőr üzemanyagdíja.

### Turnusvezetők

A **Turnusvezetők** fülön minden turnushoz az adott turnusban dolgozók közül választható vezető.

Közvetlen cím:

`https://paszthytamas.github.io/sirok-2026-munkainformaciok/admin/#leaders`

### Dolgozói fizetési jelszavak

A **Fizetések** fülön:

1. válaszd ki a dolgozót;
2. generálj vagy írj be legalább 12 karakteres személyes jelszót;
3. másold ki, és biztonságos csatornán add át a dolgozónak;
4. kattints a **Jelszó beállítása** gombra.

A már elmentett jelszó **nem olvasható vissza**. Az adatbázis csak sózott jelszókivonatot tárol. Az admin azt látja, hogy van-e jelszó beállítva. Elfelejtett jelszó esetén újat kell beállítani.

## 9. Gyors hibakeresés

- **Az adminoldal csak helyi előkészítő módot mutat:** nincs beépítve a `SUPABASE_URL` vagy `SUPABASE_ANON_KEY`; futtasd újra a Pages workflow-t.
- **Az admin belépés sikertelen:** ellenőrizd az Auth-felhasználót és az `admin_allowlist` rekordot.
- **Hiányzik a `shift_leaders` tábla:** futtasd a Supabase backend workflow-t, hogy a migrációk települjenek.
- **CORS-hiba:** a `PUBLIC_SITE_ORIGIN` pontosan `https://paszthytamas.github.io` legyen, lezáró perjel és repository-útvonal nélkül.
- **A dolgozói fizetési belépés nem működik:** ellenőrizd, hogy a `PASSWORD_PEPPER` beállt-e, és a `payroll-login` függvény települt-e.

Hivatalos dokumentáció:

- https://supabase.com/docs/guides/functions/examples/github-actions
- https://supabase.com/docs/guides/functions/deploy
- https://supabase.com/docs/reference/cli/introduction
- https://supabase.com/docs/guides/functions/secrets

