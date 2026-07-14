# Eine Welt Verkauf – Version 2.0

Diese Version ist die technische Überarbeitung der bisherigen Inventar-App.

## Neu in Version 2.0

- reparierter Kategorienfilter, einschließlich **„Alle“**
- Quagga2 statt des nicht mehr gepflegten ursprünglichen QuaggaJS
- Scanner nur für **EAN-13**, passend zu den hinterlegten Produkten
- Barcode wird erst nach drei gleichen Erkennungen übernommen
- unbekannte Barcodes schließen den Scanner nicht mehr
- Kamera und Scan-Handler werden beim Schließen sauber freigegeben
- direkte Produktsuche auf der Scan-Seite
- Suche nach Produktname, Artikelnummer, Kategorie und Barcode
- Prüfung auf ganze, nichtnegative Bestände zwischen 0 und 999
- Inventursitzungen mit Fortschritt „gezählt / offen“
- Bestand 0 wird von „noch nicht gezählt“ unterschieden
- unveränderte Bestände markieren ein Produkt als gezählt, erzeugen aber keinen unnötigen Änderungsverlauf
- vorhandene Daten aus dem bisherigen localStorage-Schlüssel `ewv2_state` bleiben erhalten

## Dateien hochladen

Alle Dateien aus diesem Ordner müssen gemeinsam in das Hauptverzeichnis des GitHub-Repositories:

- `index.html`
- `styles.css`
- `products.js`
- `app.js`

Die bisherige einzelne `index.html` wird dadurch ersetzt. GitHub Pages lädt `index.html` weiterhin automatisch.

## Wichtiger Hinweis zum Scanner

Der Scanner benötigt:

- Safari auf dem iPhone
- eine über **HTTPS** aufgerufene Seite, etwa GitHub Pages
- erteilte Kameraberechtigung
- beim ersten Laden eine Internetverbindung für Quagga2 über jsDelivr

Offline-Unterstützung und lokale Einbindung der Scannerbibliothek folgen in Version 2.2.

## Empfohlener Test auf dem iPhone

1. Bestehende App zunächst nicht löschen.
2. Die vier Dateien im Repository ersetzen beziehungsweise ergänzen.
3. GitHub-Pages-Seite in Safari neu laden.
4. Prüfen, ob die bisherigen Bestände noch vorhanden sind.
5. Neue Inventur starten.
6. Einen bekannten EAN-13-Barcode scannen.
7. Scanner schließen und erneut öffnen.
8. Dies mindestens fünfmal wiederholen.
9. Einen unbekannten Barcode scannen: Der Scanner muss geöffnet bleiben.
10. Produkt ohne Barcode über die Suche auswählen.
11. Kategorie wählen und anschließend „Alle“ antippen.
12. Negativen Bestand manuell eingeben: Speichern muss verhindert werden.
13. Inventurfortschritt und Filter „Noch offen“ kontrollieren.

## Noch nicht Bestandteil von Version 2.0

- Backup und Wiederherstellung
- vollständige Offline-PWA mit Service Worker
- Synchronisation zwischen zwei Geräten
- Google-Sheets-Anbindung

Diese Punkte folgen in den nächsten Versionen.
