# Anforderungen: realistische 3D-Plattenansicht

Fassung 1, 30.08.2026. Als lesbare Fassung veröffentlicht unter
<https://claude.ai/code/artifact/4ffcf206-8698-4d55-9076-0a79976f4d59>; diese
Datei ist die Fassung, die im Repository bleibt.

Ziel: die 3D-Ansicht der Plattenmodule zeigt den Laminatkörper mit seiner
echten Dicke, alle acht Ergebnisgrößen und - erstmals - die eingestellte
Lagerung und die Lasten.

## Entscheidungen

| Frage | Entscheidung |
| --- | --- |
| Render-Technik | eigenes WebGL2, kein Fremdcode im Bundle |
| Bildsprache | Volumenkörper mit Lagen plus schaltbare Postprozessor-Annotation |
| Ergebnisumfang | alle acht Größen wie eLamX 3.x, je Lage und Position |
| Krümmungsvorzeichen | erst am Navier-Fall nachweisen, dann festlegen |

## Warum die Render-Technik nicht optional ist

Der heutige Maleralgorithmus (`web/src/lib/plate3d.ts`, 73 Zeilen) ist exakt,
solange die Szene ein einwertiges Höhenfeld ist. Lastpfeile, Lagersymbole und
später Steifen durchdringen diese Fläche; ab da sortiert er falsch, sichtbar
als falsche Überdeckung. Die gewünschten Inhalte entziehen dem bisherigen
Ansatz seine Voraussetzung.

## Funktionale Anforderungen

- **FR-01** Volumenkörper mit tatsächlicher Laminatdicke (Ober-, Unterseite,
  vier Seitenflächen), Dicke mit demselben angeschriebenen Überhöhungsfaktor.
- **FR-02** Einzellagen an der Schnittkante sichtbar, ausgewertete Lage
  hervorgehoben, Faserrichtung als Schraffur.
- **FR-03** Acht Ergebnisgrößen (w, drei lokale Dehnungen, drei lokale
  Spannungen, minimaler Reservefaktor) mit Lagennummer und Position
  (oben/Mitte/unten) - entspricht `DeformationPlate.java`.
- **FR-04** Reservefaktor stetig statt binär, Skala bei 1,0 verankert,
  auslösende Bruchart abrufbar. Bewusste Abweichung: eLamX 3.x reduziert das
  Feld auf `RF >= 1 -> 1, sonst 2`.
- **FR-05** Farbbalken mit beschrifteten Stützstellen, Einheit und Bezug;
  divergierend für vorzeichenbehaftete Größen, sequentiell für den
  Reservefaktor; Grenzen automatisch, aber überschreibbar.
- **FR-06** Lagerungs-Symbolik an allen vier Kanten aus `bc_x`/`bc_y`:
  gelenkig = Dreiecksreihe, eingespannt = schraffierter Block, frei =
  gestrichelte Markierung. Symbole am unverformten Rand.
- **FR-07** Lasten als beschriftete Pfeile: Flächenlast als Pfeilraster,
  Punktlast am Angriffspunkt, im Beulmodul n_x/n_y/n_xy an den Kanten.
- **FR-08** Überhöhungsfaktor im Bild angeschrieben und einstellbar;
  Voreinstellung bringt w_max auf etwa ein Sechstel der kürzeren Kante.
- **FR-09** Unverformte Referenzgeometrie zuschaltbar.
- **FR-10** Kamera: Drehen, Zoomen, Verschieben; Standardansichten (oben,
  vorn, seitlich, isometrisch); Achsenkreuz; Zurücksetzen.
- **FR-11** Werteabgriff beim Zeigen, Extremstellen dauerhaft markiert.
- **FR-12** Ebenen einzeln schaltbar, Auswahl bleibt erhalten.
- **FR-13** PNG-Export in einfacher und doppelter Auflösung, mit Legende,
  Größe und Überhöhungsfaktor im Bild.
- **FR-14** Beulmodul erbt dieselbe Ansicht; Legende macht kenntlich, dass
  eine Beulform keine Amplitude hat.
- **FR-15** Rückfallebene ohne WebGL: die heutige Canvas-Ansicht, nur Körper.

## Kern und Schnittstelle (Rust/wasm)

- **CR-01** `Boundary` braucht `wdx` und `wdx2` (analytisch) - heute nur `wx`.
  Liefert zugleich exakte Flächennormalen.
- **CR-02** `DeformationResult` liefert kappa_x, kappa_y, kappa_xy auf dem
  Raster der Durchbiegung; Vorzeichen laut Nachweis, an der Struktur
  dokumentiert.
- **CR-03** Zweiter Einstiegspunkt `compute_deformation_field` für genau ein
  Feld (Größe, Lage, Position) - nicht alles auf einmal: 20 Lagen x 3
  Positionen x 7 Größen wären 420 Felder à 6561 Werte. Muster wie
  `compute_buckling_surface`.
- **CR-04** Rasterweite als Teil der Anfrage statt `SURFACE_SAMPLES = 41`;
  Voreinstellung 81 x 81, gröber für schwache Geräte.
- **CR-05** Lagengeometrie (Dicke, Winkel, z-Grenzen) nach außen reichen.
- **CR-06** Reservefaktor je Rasterpunkt mit auslösender Bruchart; nicht
  auswertbare Punkte bleiben als Lücke erkennbar statt als Zahl.

Vorhandene Bausteine: `CltLayer::stress_state` nimmt bereits `[eps, kappa]`
und eine Position entgegen, die Kriterien liegen in der Registry.

## Nicht-funktionale Anforderungen

| Nr. | Anforderung | Maß |
| --- | --- | --- |
| NFR-01 | Bundle-Zuwachs | <= 25 KB gzip |
| NFR-02 | Drehen bei voller Netzweite | >= 50 fps bei 81 x 81 |
| NFR-03 | Touch: ein Finger drehen, zwei zoomen/verschieben, ohne Seitenscroll | Telefon-Breakpoint |
| NFR-04 | Wechsel von Größe oder Lage, Kamera bleibt stehen | < 150 ms |
| NFR-05 | Helles und dunkles Erscheinungsbild gleichwertig | beide Themes |
| NFR-06 | Zweisprachig über die bestehenden Kataloge | de / en |
| NFR-07 | Tastaturbedienbar, Zeichenfläche mit Textalternative | a11y |
| NFR-08 | Zahlen folgen den Einheiten- und Formateinstellungen | bestehende Formatierung |
| NFR-09 | WebGL-Kontext wird freigegeben, Kontextverlust abgefangen | kein Leck |
| NFR-10 | Reduzierte Bewegung respektiert | prefers-reduced-motion |

## Verifikation

Das Krümmungsvorzeichen blockiert alle lagenbezogenen Größen:
`DeformationPlate.init_dZ_Kappa` setzt kappa = [w_xx, w_yy, 2*w_xy] ohne
Vorzeichenwechsel, wo die Plattentheorie kappa = -w_xx schreibt. Die
Golden-Master-Suite kann das nicht klären (der Batch-Modus druckt keine
Verformungsergebnisse). Nachweis stattdessen:

1. Allseitig gelenkig gelagerte Platte (SS/SS), unidirektionales Laminat,
   konstante Flächenlast - der Navier-Fall, gegen den die Durchbiegung des
   Ports bereits auf 2 % geprüft wurde.
2. Analytisch bekannt: in Plattenmitte steht die lastabgewandte Seite unter
   Zug.
3. Beide Vorzeichenvarianten rechnen, die passende festhalten - als Test.
4. Fällt es gegen die Java-Konvention aus: entscheiden, ob der Port abweicht
   oder das Original nachzieht (wie bei den drei bewussten Treuen im
   Last-Ply-Failure).

Weiter: Beulform gegen bekannte Halbwellenzahlen, Lagenspannungen an einem
Punkt gegen eine Handrechnung über die Q-Matrix, Bilder gegen die
Desktop-Anwendung bei gleicher Eingabe.

## Abgrenzung

Nicht Teil dieses Vorhabens: Steifen (Roadmap 2, Render-Ebene wird aber
erweiterbar gebaut), Plattenschwingung, Ausschnitte. Ob CLT-3D-Ansicht und
Versagenskörper auf dieselbe Render-Ebene wechseln, ist offen.

## Funde im Java-Original

- `DeformationPlate.getShapes` sucht Minimum und Maximum mit
  `if (value > maxVal) {...} else if (value < minVal) {...}` - ein Wert, der
  das Maximum anhebt, prüft das Minimum nicht mehr. Bei monoton wachsenden
  Werten bliebe minVal auf +unendlich; in der Praxis wird meist nur das wahre
  Minimum verfehlt und die Legende zeigt eine zu enge Spanne. Gleiches Muster
  für minZ/maxZ. Der Port führt eine gewöhnliche Suche.
- Der Reservefaktor wird auf zwei Werte reduziert, einschließlich
  `NaN -> sicher`; der Kommentar im Original benennt das Risiko selbst.

## Offene Fragen

1. Ergebnisfarbe auf dem verformten oder unverformten Körper? Vorschlag:
   verformt als Voreinstellung, unverformt zuschaltbar.
2. Eine Lage oder ein Modus "ungünstigste Lage je Punkt"?
3. Übernehmen CLT-3D-Ansicht und Versagenskörper dieselbe Render-Ebene?
4. Wie realistisch das Material? Vorschlag: matt, Faserrichtung nur an der
   Schnittkante, dazu ein "Materialansicht"-Modus ohne Ergebnisfarbe.
5. Explosionsdarstellung der Lagen jetzt einplanen oder zurückstellen?
6. Reihenfolge? Vorschlag: Render-Ebene und Körper (FR-01, FR-02, FR-10),
   dann Vorzeichennachweis und Kernarbeit (CR-01..CR-06, FR-03), dann Lager
   und Lasten (FR-06, FR-07), zuletzt Abgriff, Export, Ebenen.
