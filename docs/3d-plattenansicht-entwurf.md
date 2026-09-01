# Entwurf: 3D-Plattenansicht

Fassung 1, 30.08.2026. Folgt auf `3d-plattenansicht-anforderungen.md`.
Lesbare Fassung: <https://claude.ai/code/artifact/a29bb9df-8c74-4697-b8dc-b3454d472369>

## Leitidee: drei Lebensdauern

NFR-04 (Wechsel der Ergebnisgröße unter 150 ms, Kamera bleibt stehen) formt den
ganzen Entwurf. Getrennt wird, was sich unterschiedlich schnell ändert:

| Puffer | Inhalt | Ausgelöst durch |
| --- | --- | --- |
| Geometrie | Positionen, Normalen, Lagenkanten, Indizes | a, b, Rand, m, n, Überhöhung, Netzweite |
| Werte | ein float je Knoten | Ergebnisgröße, Lage, Position |
| Farbtabelle | 256 x 1 Textur | Thema, Skalengrenzen |

Die Kamera fasst keinen Puffer an - sie ist eine Matrix im Uniform. Deshalb
bleibt sie beim Umschalten stehen, ohne dass Zustand gerettet werden muss.

Zweiter Entwurfssatz: der Wert wird als eigenes Vertex-Attribut hochgeladen,
nicht als Farbe. Eingefärbt wird im Shader über die Farbtabelle. Legende und
Fläche lesen dieselbe Abbildung, weil es nur eine gibt.

## CR-00: zurückgestellt (Entscheidung vom 31.08.2026)

**Die Formfunktionen bleiben unverändert.** Die Konstanten der Reihe und die
Integrale sind bewusst vorausberechnet, weil sie sich in 16 Stellen nicht
bestimmen lassen; das ist die Festlegung des Originals und der Port folgt ihr.
CR-00 steht damit nicht mehr vor Schritt 1, und CR-01 (wdx, wdx2) baut auf der
bestehenden Auswertung auf.

Der Befund unten bleibt als Messung stehen - er beschreibt die Grenze der
punktweisen Auswertung, nicht einen Fehler in den Konstanten. Offen ist nur
noch, wie groß der Effekt im fertigen Feld ist: der Ritz-Koeffizient vor jeder
Formfunktion fällt mit dem Termindex ab, sodass der Fehler in w_max klein sein
kann. Diese Zahl ist nicht gemessen.

### Der Befund

Über `Boundary::wx` in `plate/boundary.rs` steht bereits eine
Genauigkeitswarnung. Nachgerechnet an den Tabellenwerten für CC:

| Term | Fehler der Formfunktion, bezogen auf ihre Amplitude |
| --- | --- |
| 1-7 | <= 1e-6 |
| 8 | 2,3e-5 |
| 9 | 6,8e-4 |
| 10 | 1,0e-2 |
| 11 | 0,25 |
| 12 | 0,69 |
| 13-20 | 1,00 (nichts Brauchbares mehr) |

Ursache: für alle Randbedingungen außer SS ist c1 = -c3 und c2 = -c4; der
Koeffizient der wachsenden Exponentialfunktion ist die Summe c3 + c4. Bei Term
10 ist diese Summe 6,2e-15 - etwa ein ulp von 0,66 - und trägt mit
(c3+c4)*e^cv/2 = 0,66 zum Ergebnis bei. Ab Term 13 sind c3 und c4 in der
Tabelle bitgleich entgegengesetzt, die Summe ist exakt null, die Information
ist nicht mehr in der Datei. Praktisch liefert `wx` für CC bei Term 20 über
weite Teile der Kante exakt 0,0, weil die beiden großen Terme sich bitgenau
aufheben und dabei den trigonometrischen Anteil verschlucken.

Andere Klammerung rettet das nicht (ab Term 13 bleibt der Fehler bei 0,66),
höher aufgelöste Tabellen auch nicht, solange die Summe als Differenz zweier
O(1)-Zahlen gebildet wird.

### Ausweg

Die Formfunktionen sind Bernoulli-Balkenmoden, durch cv allein bestimmt. In der
Normalform X = (cosh s - cos s) - sigma (sinh s - sin s) steckt der Ärger in
sigma -> 1. Gerechnet wird deshalb mit 1 - sigma:

```rust
// alle Zaehlerterme sind O(1); der Nenner ist ~e^cv/2, aber ohne Ausloeschung
fn one_minus_sigma(cv: f64) -> f64 {
    (-(-cv).exp() + cv.cos() - cv.sin()) / (cv.sinh() - cv.sin())
}

fn wx  (s: f64, om: f64) -> f64 {  (-s).exp() - s.cos() + s.sin() + om * (s.sinh() - s.sin()) }
fn wdx (s: f64, om: f64) -> f64 { -(-s).exp() + s.sin() + s.cos() + om * (s.cosh() - s.cos()) }
fn wdx2(s: f64, om: f64) -> f64 {  (-s).exp() + s.cos() + s.sin() + om * (s.sinh() + s.sin()) }
```

Gemessen erfüllt diese Form beide Einspannbedingungen am fernen Rand über alle
20 Terme auf 1e-15, gegenüber 1,8e-2 und schlechter bei der heutigen
Auswertung. Die Ableitungen erben die Stabilität - deshalb kommt CR-01 (wdx,
wdx2 ergänzen) nach CR-00, nicht davor.

### Tragweite

- Betroffen: alle Randbedingungen außer SS (bei SS ist c3 = c4 = 0). Für CC
  nachgerechnet; für CF, SC, SF, FF ist die stabile Form aus deren eigenen
  Randbedingungen herzuleiten. FF hat zusätzlich Starrkörperanteile (c5 != 0).
- Nicht betroffen: Eigenwerte und Ritz-Koeffizienten - die bauen auf den
  tabellierten Integralen auf, die die Reihe nie auswerten.
- Betroffen ist mehr als das Bild: `DeformationResult::max_deflection` wird aus
  dem abgetasteten Feld gewonnen, das Feld aus `wx`. Die Navier-Prüfung auf 2 %
  lief über SS/SS und konnte das nicht sehen.
- Der Port erbt den Befund vom Original (`Boundary_*_200.java`).

## Modulschnitt

```
web/src/lib/gl/              allgemein, kennt nur Dreiecke und Matrizen
  context.ts   program.ts   buffers.ts   camera.ts
  mat4.ts      raycast.ts   shaders.ts

web/src/lib/plateScene/      die Plattenwelt, ohne DOM
  body.ts          verformter Koerper: Deck-, Boden-, Seitenflaechen
  plies.ts         Lagenstreifen an der Schnittkante, Faserschraffur
  supports.ts      Lagersymbole je Kante aus bc_x/bc_y
  loads.ts         Pfeil-Instanzen aus Lasten bzw. n_x/n_y/n_xy
  colormap.ts      Wert -> Farbe, als 256er Tabelle
  frame.ts         wo die Platte im Weltraum liegt - eine Abbildung fuer alle
  annotation.ts    Kegel, Block, Linie: die Grundformen der Annotation
  legend.ts        Striche und Verankerung des Farbbalkens
  exportImage.ts   Bild plus Legende als PNG (FR-13)
  scale.ts         Ueberhoehungen und Skalengrenzen (war als bounds.ts und
                   exaggeration.ts geplant; eine Datei reicht)
  scene.ts         build, update, draw, dispose

web/src/components/charts/
  PlateView3D.tsx        Canvas, Gesten, Overlay, Export, Rueckfall
  PlateViewOverlay.tsx   Beschriftungen, Extremstellen, Abgriff, Achsenkreuz,
                         Ebenenschalter, Standardansichten (alles DOM)
  PlateLegend.tsx        der Farbbalken
  PlateFieldControls.tsx Groesse, Lage, Position, Skalengrenzen
  PlateViewControls.tsx  Groesse, Lage, Position, Ebenen, Ueberhoehung
  BucklingPlate3D.tsx    bleibt - die Rueckfallebene (FR-15)

web/src/store/plateViewAtoms.ts   Ansichtszustand je Laminat, persistiert
```

Beschriftungen liegen im DOM, nicht in GL: Text in WebGL hieße Schriftatlas und
damit Verlust von Bildschirmleser, Zahlenformatierung und Zweisprachigkeit
(NFR-06, NFR-07, NFR-08). Ihr `transform` wird im selben Bild geschrieben wie
der Zeichenaufruf, damit sie beim Drehen nicht nachlaufen.

## Die GL-Ebene

```ts
export interface PlateScene {
  setGeometry(g: PlateGeometry): void;                              // teuer, selten
  setValues(values: Float32Array, bounds: [number, number]): void;  // oft
  setColormap(lut: Uint8Array): void;                               // sehr oft
  setAnnotation(a: { supports: Instance[]; loads: Instance[] }): void;
  setVisibility(v: LayerVisibility): void;
  setCamera(c: OrbitCamera): void;
  pick(x: number, y: number): { u: number; v: number; value: number } | null;
  toBlob(scale: 1 | 2): Promise<Blob>;
  dispose(): void;
}
```

Die Szene ist kein React-Zustand: einmal je Canvas erzeugt, in einer Ref
gehalten, Effekte schieben Änderungen hinein. Gezeichnet wird auf Anforderung,
nicht im Dauerlauf.

Auswahl per Zeigen: Strahl gegen Dreieck auf der CPU gegen dasselbe Raster
(bei 81 x 81 rund 12 800 Dreiecke, unter einer halben Millisekunde, gedrosselt
auf ein Bild je Bewegung). Spart Framebuffer, zweites Programm und den
Lesezugriff, der die Pipeline anhält.

`webglcontextlost` abfangen, Schleife anhalten, bei `webglcontextrestored`
Puffer und Texturen neu aufbauen - die Quelldaten liegen im Store (NFR-09).

## Die Plattenszene

- **Körper:** Deck- und Bodenfläche entstehen nicht durch Verschieben in z,
  sondern entlang der Flächennormalen, p± = p_mit ± (t/2)*s_t*n. Das ist die
  Kirchhoff-Annahme selbst und macht am eingespannten Rand die Verdrehung des
  Querschnitts sichtbar.
- **Normalen** aus den Neigungen: n = normalize(-s*w_x, -s*w_y, 1). Der
  Überhöhungsfaktor s muss vor dem Normieren stehen; fehlt er, beleuchtet die
  Szene die unverformte Platte und der Körper wirkt flach.
- **Lagen:** Streifenband je Lage an jeder Kante aus deren z-Grenzen (CR-05).
  Die ausgewertete Lage wird über ein Uniform hervorgehoben, nicht durch neue
  Geometrie. Faserrichtung als prozedurale Schraffur im Fragment-Shader.
- **Annotation:** Lagersymbole und Lastpfeile als je eine Grundform mit
  Instanzattributen. supports.ts/loads.ts sind reine Funktionen von der Eingabe
  auf eine Instanzliste - in Node prüfbar, ohne dass ein Pixel entsteht.
- **Farbe:** colormap.ts erzeugt aus chartColors.ts eine 256er Tabelle;
  dieselbe Tabelle malt die Legende im DOM.

## Kern-Schnittstelle

Zwei neue Einstiegspunkte. `compute_deformation` bleibt unverändert;
Krümmungen gehören nicht dorthin, sie würden die Antwort verdreifachen, die bei
jedem Tastendruck über den Worker geht.

Gebaut wurde davon nur der zweite. `compute_plate_geometry` ist entfallen:
die Normalen kommen aus den Neigungen des gezeichneten Feldes und nicht aus
denen des echten (siehe `body.ts`), weil der Ueberhoehungsfaktor vor dem
Normieren stehen muss - exakte Neigungen aus dem Kern haetten also gar nicht
verwendet werden koennen. Die Geometrie ist stattdessen `compute_deformation_field`
mit `field: Deflection`, was auch garantiert, dass Koerper und Werte auf
demselben Raster liegen.

```rust
// Werte: aendert sich mit Groesse, Lage, Position. Geometrie bleibt stehen.
pub fn compute_deformation_field(request_json: &str) -> Result<String, JsValue>;

struct DeformationFieldRequest {
    laminate, materials, input, coefficients,
    field: PlateField,        // Deflection | StrainPar | ... | ReserveFactor
    layer: usize,
    position: LayerPosition,  // Upper | Middle | Lower
    samples: usize,
}
struct PlateFieldResponse {
    values, min, max, min_at, max_at,
    failure: Option<Vec<Vec<Option<FailureType>>>>,  // nur beim Reservefaktor
}
```

Beide Typen tragen `#[cfg_attr(feature = "ts", derive(ts_rs::TS))]`, und beide
werden in `wasm.worker.ts` (ENTRY_POINTS) und `wasm.ts` (elamx) eingetragen -
sonst weist der Worker sie namentlich ab.

JSON bleibt: bei 81 x 81 sind drei Geometrieraster rund 400 KB JSON, gut 4 ms
zum Zerlegen. Erst über 121 x 121 lohnt der binäre Weg (Float32Array als
Transferable); das ist dann eine Änderung im Worker, nicht im Entwurf.

## Datenfluss und Invalidierung

| Änderung | Kern-Aufruf | Neu hochgeladen | Kamera |
| --- | --- | --- | --- |
| Maß, Rand, m/n, Last | Lösung + Geometrie + Feld | alles | bleibt |
| Netzweite | Geometrie + Feld | Geometrie, Werte | bleibt |
| Überhöhung | - | Geometrie (lokal gerechnet) | bleibt |
| Größe, Lage, Position | Feld | Werte | bleibt |
| Skalengrenzen, Thema | - | Farbtabelle | bleibt |
| Ebene ein/aus, Drehen | - | nichts | - |

Die Überhöhung ist bewusst lokal: Positionen und Normalen aus w, w_x, w_y neu
zu bilden kostet bei 6561 Knoten unter einer Millisekunde. Ein Regler, der
dafür den Worker fragt, fühlt sich zäh an.

## React-Anbindung

`plateViewAtoms.ts`, gebaut wie `deformationAtoms.ts`: eine Familie je Laminat,
`atomWithStorage`, Schlüssel `elamx.plateview.<laminateId>`.

```ts
export interface PlateViewState {
  field: PlateFieldId;
  layer: number;                 // beim Zeichnen geklemmt, nicht beim Schreiben
  position: LayerPositionId;
  exaggeration: number | "auto";
  bounds: [number, number] | "auto";
  visible: { body; reference; supports; loads; legend; axes };
}
```

Zwei Familien entlang derselben Trennung: `plateGeometryFamily` (Maße, Rand,
Terme, Netz) und `plateFieldFamily` (Größe, Lage, Position), beide über
`loadableWithLastValue`, damit beim Umschalten das vorige Bild stehen bleibt.

## Tests

Rust: stabile Formfunktion gegen eine Referenz in hoher Genauigkeit je
Randbedingung über alle 20 Terme; als Eigenschaft die Randbedingungen selbst
(X = 0, dX/dx = 0 an eingespannten Rändern) auf 1e-12 - der Test, den die
heutige Auswertung ab Term 10 nicht besteht. wdx/wdx2 gegen zentrale
Differenzen bei niedrigen Termen. Krümmungsfelder gegen Navier, darin der
Vorzeichennachweis. Lagenspannung an einem Punkt gegen eine Handrechnung über
die Q-Matrix.

TypeScript in Node: body.ts (Knotenzahl, Indexbereiche, Normalen gegen die
analytische Neigung, w == 0 muss exakt eben sein), colormap.ts (Endpunkte,
Mitte, Monotonie, beide Themen), bounds.ts (konstantes Feld, NaN-Lücken),
supports.ts/loads.ts (alle sechs Randkombinationen, Vorzeichenwechsel),
mat4.ts und raycast.ts gegen bekannte Werte.

Browser: Bildvergleich je Ergebnisgröße, mit der Prüfung aus der Notiz zu den
Bildschirmfotos (zwei Ansichten müssen sich in den Bytes unterscheiden). Dazu
eine Aussage ohne Auge: bei Flächenlast nach unten muss der Bildpunkt in der
Plattenmitte über readPixels auf der erwarteten Seite der divergierenden Skala
liegen.

## Budgets

| Größe | Entwurf | Grenze |
| --- | --- | --- |
| Zeichenaufrufe je Bild | 6-8 | - |
| Knoten bei 81 x 81, 20 Lagen | ~20 000 | - |
| Dreiecke | ~26 000 | - |
| Geometrie-Nutzlast | ~400 KB JSON | binär ab 121 x 121 |
| Werte-Nutzlast je Wechsel | ~130 KB JSON | NFR-04: 150 ms |
| Quelltext gl/ + plateScene/ | ~1500 Zeilen | NFR-01: 25 KB gzip |

## Reihenfolge

| Schritt | Inhalt | Danach sichtbar |
| --- | --- | --- |
| 1 | gl/ + plateScene/body + PlateView3D, nur w | beleuchteter Körper mit Dicke, drehbar (FR-01, FR-10, FR-15) |
| 2 | CR-01, CR-04, Lagen | Schnittkante mit Lagen, Faserschraffur (FR-02) |
| 3 | Vorzeichennachweis, CR-02/03/06, compute_deformation_field | alle acht Größen, Legende (FR-03..05) - Roadmap-Punkt 1 |
| 4 | supports.ts, loads.ts, Overlay | Lager und Lasten im Bild (FR-06, FR-07, FR-09) |
| 5 | Abgriff, Ebenen, Export, Beulmodul | FR-08, FR-11, FR-12, FR-13, FR-14 |

**Alle fünf Schritte sind gebaut.** Was unten noch von Vorhaben spricht, ist
als Begründung stehen geblieben, nicht als Plan.

Schritt 0 (CR-00) ist entfallen, siehe oben.

Schritt 4 ist vorgezogen worden, weil er als einziger nichts aus dem Kern
braucht: Lagerung und Lasten stehen bereits in der Eingabe, `supports.ts` und
`loads.ts` sind reine Funktionen davon, und beide Module hängen ohnehin schon
an derselben `PlateView3D`. Damit ist FR-07 ganz erledigt - auch die
Kraftflüsse n_x/n_y/n_xy des Beulmoduls - und nicht nur der Querlast-Teil.

## Was das Bauen entschieden hat

Festlegungen, die im Entwurf oben nicht standen und die man am fertigen Bild
nicht mehr ablesen kann:

- **Verdeckte Annotation wird geisterhaft durchgezeichnet.** Eine Flächenlast
  mit positivem Vorzeichen drückt von unten; ihre Pfeile liegen dann korrekt
  unter der Platte, in der Schale, in die sich die Platte gerade gewölbt hat -
  und die Voreinstellung der Kamera zeigt eine Platte ohne erkennbare Last.
  Jede Annotationsgruppe wird deshalb zweimal gezeichnet: einmal mit
  umgekehrtem Tiefentest und 22 % Deckkraft für genau die Teile, die der
  Körper verdeckt, einmal gewöhnlich. Das ist der verdeckte Kantenzug einer
  Schnittzeichnung und liest sich als "dahinter", nicht als zweite Pfeilart.
- **Die Annotation hat zwei eigene Farbrollen** (`chartColors.annotation`),
  bewusst außerhalb der divergierenden Skala: ein Lastpfeil darf nie als Wert
  auf dem Körper zu lesen sein, neben dem er steht.

- **Das Krümmungsvorzeichen ist κ = -w''**, nachgewiesen am Navier-Fall statt
  aus Konvention übernommen: nur damit steht in der Plattenmitte die
  lastabgewandte Seite unter Zug. Das weicht bewusst vom Original ab, das die
  rohen zweiten Ableitungen einsetzt (siehe `plate/field.rs`).
- **CR-05 brauchte nichts.** Die Lagenbeiträge der CLT-Antwort tragen den
  aufgefalteten Stapel mit Winkel, Dicke und Mittelebene bereits - genau das,
  was die Lagengeometrie braucht.
- **CR-04 ist gemessen statt geschätzt.** Vom Klick bis zu den neuen Zahlen,
  Worker-Weg eingerechnet, im softwaregerenderten Browser: Reservefaktor 40 ms
  bei 41 x 41, 65 ms bei 81 x 81, Budget 150 ms. Deshalb ein Raster für alle
  Größen - und der Wechsel zum Reservefaktor baut den Körper nicht neu.
- **Körper und Werte teilen ein Raster.** Die Werte sind eine Farbe je Knoten;
  ein Feld eine Stufe feiner würde die Platte mit fremden Zahlen einfärben.
  Deshalb kommt auch die Durchbiegung aus `compute_deformation_field` und nicht
  aus `DeformationResult::surface`, das bei festen 41 abtastet.
- **Feld und Auswahl reisen zusammen.** Den Namen aus dem Ansichtszustand und
  die Zahlen aus einem noch nachziehenden Atom zu lesen, zeigte einen
  Bildlauf lang die Zahlen der einen Größe unter dem Namen der anderen - und
  färbte die alten Werte mit der neuen Skala.
- **Der Reservefaktor hat seine eigene Rampe**, bei 1,0 verankert und in der
  Reichweite gedeckelt: am gelenkigen Rand ist die Spannung null und das
  Kriterium meldet 1e16, und eine darüber gespannte Skala färbt die ganze
  Platte neutral.
- **Die Lagen der Schnittkante sind eigene Streifen.** Ein Knoten auf einer
  Zwischenschicht gehört zu zwei Lagen und könnte nur den Faserwinkel einer
  von beiden tragen. `CltLaminate` stapelt Lage 0 oben, die gezeichneten
  Bänder laufen von unten - `plyGeometryOf` liefert die Abbildung dazwischen,
  und ihr Test benutzt einen unsymmetrischen Stapel, weil ein symmetrischer
  nicht durchfallen kann.
- **Der Abgriff ist ein Marsch gegen das Höhenfeld**, nicht ein Strahl gegen
  die Dreiecke: der Körper ist eine einwertige Fläche, und ein Marsch
  antwortet in wenigen Dutzend Schritten statt in einem Schnitttest je Dreieck
  je Zeigerbewegung. Sein Test verlangt, dass Projektion und Abgriff einander
  umkehren.

## Risiken

- Vergessene Überhöhung in den Normalen sieht aus wie ein Beleuchtungsproblem,
  ist aber Geometrie. Gegenmittel: der Normalen-Test in Node.
- Z-Kämpfe zwischen Drahtgitter und Fläche: polygonOffset, keine verschobene
  Kopie des Gitters.
- Sehr dünne Lagen ergeben Streifen unter einem Pixel: unterhalb einer
  Mindestbreite zusammenfassen und das in der Beschriftung sagen.
- Der Reservefaktor braucht 6561 Kriteriums-Auswertungen je Feld. Messen, bevor
  die Netzweite auf 81 gesetzt wird; sonst für diese Größe gröber abtasten.
