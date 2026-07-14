🌍 Eine Welt Verkauf – Fair-Trade Inventar-App

Eine mobile Web-App zur Bestandsverwaltung für einen monatlichen Fair-Trade-Verkauf nach dem Gottesdienst. Entwickelt für zwei Personen, die Fair-Trade-Produkte des Fairkauf Handelskontors München weiterverkaufen und den Gewinn am Ende des Jahres spenden.


Hintergrund & Anforderungen

Ausgangssituation


Monatlicher Verkauf nach dem Gottesdienst
Einkauf beim Fairkauf Handelskontor München, Weiterverkauf mit kleinem Aufschlag
Gewinn wird am Ende des Jahres gespendet
Bisher: manuelle Inventur auf Papier nach jedem Verkauf, manuelle Bestellliste


Anforderungen an die App


Alle Produkte mit Barcode, Preisen und Mindestbestand hinterlegt
Nach dem Verkauf: Produkt per Barcode scannen oder suchen → neuen Restbestand eintragen
Übersicht über den aktuellen Bestand aller Artikel
Automatische Bestellliste: zeigt alle Artikel unter Mindestbestand
Produktdetails abrufbar (Einkaufspreis netto/brutto, Verkaufspreis, Gewinn, Artikelnummer)
Läuft komplett im Browser – kein Backend, keine Registrierung, kein App-Store
Funktioniert auf iPhone (Safari) und kann zum Homescreen hinzugefügt werden (PWA)
Zwei Personen können die App unabhängig voneinander nutzen



Features

TabFunktion📷 ScannenBarcode per Kamera scannen oder manuell eingeben → Restbestand eintragen📦 BestandÜbersicht aller Artikel mit Ampel-Anzeige (grün / gelb / rot) + Gesamtgewinn im Lager🏷️ ProdukteAlle Produkte mit Einkaufspreis, Verkaufspreis, Gewinn pro Stück und allen Details🛒 BestellungAutomatische Liste aller Artikel unter Mindestbestand inkl. Kopierfunktion📋 VerlaufProtokoll aller Bestandsänderungen mit Datum und Differenz


Technische Details


Technologie: Reines HTML + CSS + JavaScript – eine einzige Datei, kein Build-Tool, kein Framework
Barcode-Scanner: QuaggaJS über CDN – unterstützt EAN-13, EAN-8, Code 128, UPC
Datenspeicherung: localStorage im Browser – Daten bleiben erhalten solange der Browser-Cache nicht geleert wird
PWA: apple-mobile-web-app-capable Meta-Tags für Installation auf dem iPhone Homescreen
Produktdaten: Direkt im Code hinterlegt (40 Produkte) – kein externes Backend nötig
Kategorien: TEE, KAFFEE, KAKAO, SCHOKOLADE, SNACKS, ZUCKER, REIS, HONIG, GEBÄCK


Produktdaten-Struktur

Jedes Produkt enthält:

javascript{
  id: "204-3050901",           // Artikelnummer (Fairkauf Handelskontor)
  name: "Bio Café Orgánico gemahlen",
  cat: "KAFFEE",               // Kategorie
  unit: "250 g",               // Inhalt / Einheit
  buyNet: 6.08,                // Einkaufspreis netto
  buyGross: 6.51,              // Einkaufspreis brutto
  sell: 7.50,                  // Verkaufspreis
  vat: 7,                      // MwSt-Satz in %
  min: 6,                      // Mindestbestand (löst Bestellliste aus)
  order: 6,                    // Standard-Bestellmenge
  barcode: "4013320035009"     // EAN-13 Barcode
}


Installation & Nutzung

Auf dem iPhone (empfohlen)


Den Link dieser GitHub Pages Seite in Safari öffnen
Unten auf das Teilen-Symbol tippen (Kasten mit Pfeil nach oben)
„Zum Home-Bildschirm" wählen → „Hinzufügen"
Die App erscheint als Icon auf dem Homescreen



⚠️ Wichtig: Safari verwenden, nicht Chrome oder die Claude-App. Nur Safari unterstützt die Homescreen-Installation und den Kamera-Zugriff für den Barcode-Scanner.



Lokal / Desktop

Die Datei index.html direkt im Browser öffnen – keine Installation nötig.


App aktualisieren

Da die Bestände im localStorage des Browsers gespeichert sind (nicht in der HTML-Datei), bleiben alle eingetragenen Werte beim Update erhalten.

Vorgehen bei einem Update:


Neue index.html in dieses Repository hochladen (alte überschreiben)
GitHub Pages veröffentlicht die neue Version automatisch nach ~1-2 Minuten
App im Safari neu laden – fertig



Inventur-Import

Beim ersten Start ohne gespeicherte Daten lädt die App automatisch die zuletzt erfasste Inventur. Um neue Inventur-Werte einzuspielen: Werte im INVENTUR-Objekt im JavaScript anpassen und als neues Update hochladen.


Bekannte Einschränkungen


Keine Synchronisation zwischen Geräten: Jedes iPhone hat seinen eigenen localStorage. Wenn beide Personen getrennt Bestand eintragen, müssen die Werte manuell abgeglichen werden.
Kein Cloud-Backup: Bei „Website-Daten löschen" in den Safari-Einstellungen gehen die gespeicherten Bestände verloren.
Barcode-Lücken: Nicht alle Produkte haben einen hinterlegten Barcode – diese können über die Suche im Bestand-Tab manuell angepasst werden.



Für eine Echtzeit-Synchronisation zwischen zwei Geräten wäre eine Google Sheets Anbindung per API der nächste sinnvolle Schritt.
