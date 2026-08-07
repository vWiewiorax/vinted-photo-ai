# Vinted Photo AI

Aplikacja internetowa, która pobiera zdjęcia z oferty Vinted (albo przyjmuje pliki
z dysku) i automatycznie poprawia ich atrakcyjność: rozświetlenie, balans bieli,
auto-poziomy, kontrast, nasycenie i wyostrzenie.

## Jak to działa

1. **Link do oferty** — `POST /api/vinted` pobiera stronę oferty i wyciąga z jej
   wstrzykniętego stanu adresy zdjęć w oryginalnej rozdzielczości
   (`full_size_url`, z fallbackiem na wariant `f800`). Podglądy lecą przez
   `GET /api/image?url=…`, który przepuszcza tylko hosty `images*.vinted.net`.
2. **Własne zdjęcia** — drag & drop albo wybór z eksploratora plików; nic nie
   opuszcza Twojej przeglądarki poza wywołaniem korekty.
3. **Korekta** — `POST /api/enhance` (sharp, Node runtime). W trybie **Auto**
   backend liczy histogram luminancji i dobiera parametry per zdjęcie, celując w
   zadaną średnią jasność. Rozjaśnianie robi krzywa gamma (`x^e`, `e < 1`), więc
   cienie idą w górę, a biel zostaje bielą — bez przepalania. Przełącznik
   **Delikatnie / Standard / Mocno** ustawia docelową jasność, a tryb ręczny
   daje suwaki (m.in. osobne wyciąganie cieni).
4. **Wynik** — podgląd „przed / po”, pobranie pojedynczego JPEG-a (jakość 92,
   dłuższy bok do 2000 px) albo wszystkich w ZIP-ie.

## Uruchomienie

```bash
npm install
npm run dev      # http://localhost:3000
```

Inne skrypty: `npm run build`, `npm run lint`.

## Uwagi

- Korekta jest algorytmiczna (analiza histogramu + pipeline sharp), bez
  zewnętrznego modelu generatywnego — działa bez żadnych kluczy API i nie
  dorysowuje niczego, czego nie ma na zdjęciu.
- Vinted może ograniczać ruch z serwerów (rate limiting / Cloudflare). Jeśli
  pobranie oferty się nie uda, ręczne wgranie zdjęć zawsze działa.
- Pobieraj wyłącznie zdjęcia, do których masz prawa (np. własne oferty).
