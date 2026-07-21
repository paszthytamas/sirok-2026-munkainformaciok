# Siroki Motoros találkozó 2026 – munkainformációk

Mobilbarát GitHub Pages-webalkalmazás a biztonsági szolgálat beosztásához, turnusváltásaihoz, autóbeosztásaihoz, általános információihoz és személyes fizetési összesítőihez.

Részletes admin- és backendtelepítés: [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md).

## Mit tartalmaz?

1. **Heti tábla:** név szerint rendezett beosztás, zöld `x` jelölésekkel.
2. **Turnuslétszám:** session-alapú checkboxos ellenőrző névsor mindenkiről, akinek az adott turnusban jelen kell lennie; a turnusvezető külön kiemelt blokkban látható.
3. **Dolgozói adatlap:** egyetlen kiválasztott dolgozó összes turnusa, folyamatos munkablokkja, érkezése, távozása, útitársa és sofőri szerepe egy nézetben.
4. **Személyenként:** turnusok, folyamatos munkablokkok és óraszám.
5. **Érkezés / távozás:** a közvetlenül megelőző turnushoz képzett, ABC-rendű listák.
6. **Utazási javaslat:** automatikusan optimalizált autócsoportok minden érkezési és távozási időpontra.
7. **Autóbeosztás:** vizuálisan elkülönített érkezési és távozási utaslisták, valamint védett, drag-and-drop adminfelület.
8. **Turnusvezetők:** nyilvános vezetői beosztás és külön adminnézet a kijelölésükhöz.
9. **Kontaktlista:** dolgozói jelszóval védett telefonszámok és mobilon közvetlen `tel:` hívási linkek.
10. **Munkainformációk:** a `data/munkainformaciok.md` fájlból készülő HTML-nézet.
11. **Fizetések:** jelszavas személyes nézet, turnusonkénti órakorrekcióval, dinamikus óradíjjal és kizárólag a sofőrnek elszámolt üzemanyagdíjjal.

## Automatikus utazócsoportok

A párosító algoritmus minden dolgozópárnál három szempontból számít együttmozgási pontszámot:

- a közös érkezési és távozási események Jaccard-hasonlósága;
- a teljes heti turnusminta hasonlósága;
- az ismétlődő közös mozgások száma.

Az algoritmus először a legmagasabb pontszámú párokat választja ki, majd az adott csoporthoz átlagosan legjobban illeszkedő személyekkel tölti fel az autót. A csoportméretek kiegyensúlyozottak, ezért például öt ember és négyfős kapacitás esetén 3+2 fős beosztás készül, nem 4+1. A férőhely 3–9 fő között állítható.

Az Excel nem tartalmaz lakcímet, indulási helyet, jogosítványt vagy rendelkezésre álló autót, ezért a javaslat az időbeli együttmozgást optimalizálja. A sofőrt és a végleges utaslistát az adminisztrátor rögzíti.

## Excel-adatforrás

A repositoryban lévő `data/Sirok 2026 beosztás.xlsx` az egyetlen beosztási adatforrás. A GitHub Actions minden `main` ágra történő feltöltéskor újragenerálja a weboldal adatait.

A feldolgozás szabályai:

- megkeresi a `contact` nevű strukturált Excel-táblát, függetlenül a munkalap nevétől;
- a nevet a `Név` oszlopból olvassa;
- csak azokat az oszlopokat használja, amelyek fejléce `Sze`, `Cs`, `P` vagy `Szo` nappal kezdődik, majd új sorban `óó:pp - óó:pp` időintervallum áll;
- a Bagossy, Lakatos Ferike, Salgótarján, Macok és minden más oszlop kimarad;
- csak a legalább egy valódi turnusban kis- vagy nagybetűtől függetlenül pontosan `x` értékkel szereplő dolgozó kerül a weboldalra.

Az Excel frissítéséhez egyszerűen cseréld le a repositoryban a fájlt ugyanazon a néven, majd töltsd fel a változást.

## Kontakt Excel

A telefonszámokhoz a `data/Sirok 2026 kontaktok - sablon.xlsx` fájl használható. Kitöltés után a fájlt `data/Sirok 2026 kontaktok.xlsx` néven töltsd fel. A munkalapon a strukturált Excel-tábla neve `contacts`, oszlopai:

- `Név` – a beosztásban szereplő név, változtatás nélkül;
- `Telefonszám` – szövegként, lehetőleg E.164 formában, például `+36301234567`;
- `Megjegyzés` – opcionális.

A `Kontaktlista szinkronizálása` GitHub Actions workflow ellenőrzi a neveket és telefonszámokat, majd a Supabase védett `worker_contacts` táblájába tölti őket. A Pages build nem másolja a telefonszámokat a nyilvános webes fájlok közé. A repository maradjon privát.

## Helyi futtatás

Python 3.12 és Node.js 20+ szükséges.

```bash
python -m pip install -r requirements.txt
python scripts/build_data.py
python scripts/write_config.py
python -m unittest discover -s tests -p 'test_*.py'
npm test
python -m http.server 8000 --directory site
```

Ezután: `http://localhost:8000`

Supabase nélkül a nyilvános beosztási nézetek teljesen működnek. Az adminfelület helyi előkészítő módban használható, és az autóbeosztás JSON-ként exportálható. A jelszavak és fizetési adatok éles használatához a következő biztonságos háttér szükséges.

## Miért kell külön háttér a fizetésekhez és kontaktokhoz?

A GitHub Pages statikus tárhely. Ha a fizetési adat vagy a jelszóellenőrzés JavaScriptben vagy nyilvános JSON-fájlban lenne, bármely látogató letölthetné. Ez a projekt ezért:

- csak a nyilvános beosztást és autóbeosztást szolgálja ki GitHub Pagesről;
- a jelszó-kivonatokat, fizetési adatokat és telefonszámokat Supabase-ben, RLS mögött tartja;
- a személyes jelszót PBKDF2-SHA-256 algoritmussal, egyedi sóval ellenőrzi;
- egy szerveroldali HMAC-keresőértékkel teszi lehetővé a felhasználónév nélküli belépést;
- soha nem küldi le más dolgozók fizetési adatait a böngészőnek;
- a teljes kontaktlistát csak egy érvényes dolgozói jelszó után, session-alapon adja át.

## Supabase beállítása

1. Hozz létre egy Supabase-projektet.
2. Futtasd a `supabase/migrations/202607210001_initial.sql` fájlt a Supabase SQL Editorban, vagy használd a Supabase CLI `supabase db push` parancsát.
3. Az Authentication felületen hozz létre egy adminfelhasználót e-maillel és erős jelszóval.
4. Az SQL Editorban engedélyezd adminnak az előző felhasználót:

   ```sql
   insert into public.admin_allowlist (user_id)
   select id from auth.users where email = 'SAJAT-ADMIN-EMAIL-CIM';
   ```

5. Generálj legalább 32 bájtos véletlen `PASSWORD_PEPPER` értéket, és állítsd be Edge Function secretként. Ezt később ne cseréld le, mert a meglévő dolgozói jelszavak keresőértéke ehhez kötődik.
6. Állítsd be az engedélyezett GitHub Pages origint, például `https://paszthytamas.github.io`:

   ```bash
   supabase secrets set PASSWORD_PEPPER="EROS_VEDETLEN_TITOK" ALLOWED_ORIGIN="https://paszthytamas.github.io"
   ```

7. Telepítsd a függvényeket:

   ```bash
   supabase functions deploy admin-api
   supabase functions deploy payroll-login
   supabase functions deploy contacts-login
   ```

8. A GitHub repository **Settings → Secrets and variables → Actions → Variables** részén vedd fel:

   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`

Az anon kulcs böngészőoldali, nyilvános kulcs; a `service_role` kulcsot viszont soha ne tedd GitHub-változóba vagy a weboldal fájljaiba. A Supabase automatikusan elérhetővé teszi azt a telepített Edge Functionök számára.

A turnusvezetői bővítéshez a `supabase/migrations/202607210002_shift_leaders.sql` migrációt is futtasd le. Ezután a turnusvezetők az `/admin/#leaders` adminnézetben állíthatók be.

## GitHub Pages közzététel

> **Fontos:** a mellékelt forrás-Excel az aktív beosztáson kívül további név- és kapcsolati adatokat is tartalmaz. A repositoryt ezért **privátként** hozd létre. Ne töltsd fel ezt az Excelt nyilvános repositoryba.

1. Töltsd fel a projektet egy új, **privát** repository `main` ágára.
2. A repository **Settings → Pages → Build and deployment → Source** mezőjében válaszd a **GitHub Actions** lehetőséget.
3. A `.github/workflows/pages.yml` feldolgozza az Excelt és a Markdown fájlt, lefuttatja a teszteket, majd közzéteszi a `site` könyvtárat.

Az oldal várható címe: `https://paszthytamas.github.io/REPOSITORY-NEVE/`.

Privát repositoryból a Pages használhatósága a GitHub-előfizetéstől függ. Ha a fiókod nem engedélyezi, biztonságos alternatíva egy külön privát adat-repository és egy nyilvános Pages-repository; az utóbbi workflow-ja egy szűk jogosultságú, csak olvasási tokent használva olvassa ki az Excelt. A teljes forrás-Excelt ebben az esetben sem szabad a nyilvános repositoryba tenni.

## Adatvédelmi megjegyzés

A név szerinti munkaidő-beosztás személyes adat. A weboldal `noindex` jelölést és tiltó `robots.txt` fájlt használ, de ez **nem hozzáférés-védelem**. Ha a beosztást sem szeretnéd nyilvánosan hozzáférhetővé tenni, a GitHub Pages elé külön beléptető réteg (például Cloudflare Access) szükséges. A fizetési adatok ettől függetlenül nem kerülnek a statikus oldalba.
