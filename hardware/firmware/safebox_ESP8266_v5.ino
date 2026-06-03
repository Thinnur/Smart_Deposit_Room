/*
 * ============================================================
 *  SMART SAFE DEPOSIT BOX - ESP8266 v5
 *  Board: NodeMCU 1.0 (ESP-12E)
 *
 *  [v5] Tambahan dari v4:
 *       - ENROLL_RFID: daftarkan RFID nasabah dari Web Dashboard
 *       - ENROLL_FP  : daftarkan sidik jari dari Web Dashboard
 *       - Progress pendaftaran dikirim real-time ke tabel commands
 *         via PATCH payload.progress → ditampilkan di web
 *
 *  ALUR UTAMA (sama seperti v4):
 *  1. STANDBY     → Scan RFID (masuk) → Pintu BUKA sebentar
 *  2. PINTU_MASUK → 4 detik → Pintu KUNCI otomatis
 *  3. DI_DALAM    → FP standby terus sampai cocok
 *                 → FP cocok → Brankas BUKA
 *                 → Scan RFID → minta keluar
 *  4. BRANKAS_BUKA→ FP masih standby
 *                 → Scan RFID → Brankas KUNCI + Pintu BUKA
 *  5. PINTU_KELUAR→ 4 detik → Pintu KUNCI → log KELUAR → STANDBY
 *
 *  Timeout safety: 30 menit di dalam → auto keluar
 *  State Restore on Reboot: query log_pintu terakhir
 *
 *  PIN:
 *  RFID SDA→D8 RST→D2 SCK→D5 MISO→D6 MOSI→D7
 *  FP TX→D1 FP RX→D0
 *  Servo Pintu→D3  Servo Brankas→D4
 *  Buzzer→GPIO3
 * ============================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_Fingerprint.h>
#include <SoftwareSerial.h>
#include <Servo.h>
#include <time.h>

// ============================================================
//  KONFIGURASI
//  Salin config.h.example → config.h lalu isi nilainya.
//  File config.h TIDAK boleh di-commit ke repository.
// ============================================================
#include "config.h"

const char* WIFI_SSID     = CFG_WIFI_SSID;
const char* WIFI_PASSWORD = CFG_WIFI_PASSWORD;
const char* SUPABASE_URL  = CFG_SUPABASE_URL;
const char* SUPABASE_KEY  = CFG_SUPABASE_KEY;
const char* NTP_SERVER    = CFG_NTP_SERVER;
const long  GMT_OFFSET    = CFG_GMT_OFFSET;

// ============================================================
//  PIN
// ============================================================
#define RFID_SS       D8
#define RFID_RST      D2
#define FP_SOFT_RX    D1
#define FP_SOFT_TX    D0
#define SERVO_PINTU   D3
#define SERVO_BRANKAS D4
#define BUZZER        3

// ============================================================
//  PARAMETER
// ============================================================
#define MAX_FAIL_RFID      3
#define MAX_FAIL_FP        3
#define DURASI_PINTU_BUKA  4000
#define TIMEOUT_DI_DALAM   1800000UL
#define CACHE_REFRESH      300000
#define POLL_INTERVAL      5000
#define HTTP_TIMEOUT       15000
#define HTTP_DELAY         500
#define ENROLL_TIMEOUT_MS  15000

// ============================================================
//  STRUCT
// ============================================================
struct Nasabah {
  String id;
  String nama;
  String rfid_uid;
  int    fingerprint_id;
};
struct Loker {
  String id;
  String nomor_loker;
  String id_nasabah;
};

#define MAX_NASABAH 20
#define MAX_LOKER   20
Nasabah db_nasabah[MAX_NASABAH];
Loker   db_loker[MAX_LOKER];
int     total_nasabah = 0;
int     total_loker   = 0;
int     cfgJamBuka    = 8;
int     cfgJamTutup   = 23;

// ============================================================
//  OBJEK
// ============================================================
MFRC522 rfid(RFID_SS, RFID_RST);
SoftwareSerial fpSerial(FP_SOFT_RX, FP_SOFT_TX);
Adafruit_Fingerprint finger(&fpSerial);
Servo servoPintu, servoBrankas;

// ============================================================
//  STATE
// ============================================================
enum State {
  STANDBY,
  PINTU_MASUK,
  DI_DALAM,
  BRANKAS_BUKA,
  PINTU_KELUAR,
  ALARM
};
State state = STANDBY;

Nasabah* nasabahAktif = nullptr;
int failRFID = 0;
int failFP   = 0;

unsigned long timerPintu   = 0;
unsigned long timerDalam   = 0;
unsigned long timerCache   = 0;
unsigned long timerPollCmd = 0;

// ============================================================
//  DEKLARASI FUNGSI
// ============================================================
void loopStandby();
void loopPintuMasuk();
void loopDiDalam();
void loopBrankasBuka();
void loopPintuKeluar();
String sbGET(String endpoint, int maxRetry = 3);
bool sbPOST(String endpoint, String body);
String sbPOSTGetBody(String endpoint, String body);
bool sbPATCH(String endpoint, String body);
void fetchSettings();
void fetchNasabah();
void fetchLoker();
void restoreState();
void logPintu(String idNasabah, String tipe, bool anomali);
String logPintuGetID(String idNasabah, String tipe, bool anomali);
void logLoker(String idNasabah, String idLoker, String status);
void triggerCameraCapture(String logPintuID);
void pollCommands();
void markCommandDone(String cmdID);
void updateCmdProgress(String cmdID, String nasabahId, String msg, int fpId);
void handleEnrollRFID(String cmdID, String nasabahId);
void handleEnrollFP(String cmdID, String nasabahId, int fpTargetId);
Nasabah* cariNasabahRFID(String uid);
Nasabah* cariNasabahFP(int fpID);
Loker* cariLoker(String idNasabah);
bool isJamKerja();
void bukaPintu();
void tutupPintu();
void bukaBrankas();
void tutupBrankas();
void triggerAlarm();
void buzzerBeep(int d);
void buzzerDenied();
void buzzerAlert();
void buzzerError();
String getUID();
int scanFP();
void connectWiFi();
const char* stateStr();

// ============================================================
//  SETUP
// ============================================================
void setup() {
  Serial.begin(74880);
  delay(200);
  Serial.println("\n=== SMART SAFE DEPOSIT BOX v5 (ESP8266) ===");

  pinMode(BUZZER, OUTPUT);
  digitalWrite(BUZZER, LOW);

  servoPintu.attach(SERVO_PINTU);
  servoBrankas.attach(SERVO_BRANKAS);
  servoPintu.write(0);
  servoBrankas.write(0);

  SPI.begin();
  rfid.PCD_Init();
  delay(100);
  Serial.println("[RFID] OK");

  fpSerial.begin(57600);
  finger.begin(57600);
  delay(200);
  if (finger.verifyPassword()) {
    Serial.println("[FP] Sensor OK, kapasitas: " + String(finger.capacity));
  } else {
    Serial.println("[FP] ERROR - Cek wiring!");
    buzzerError();
  }

  connectWiFi();

  configTime(GMT_OFFSET, 0, NTP_SERVER);
  Serial.print("[NTP] Sync");
  time_t now = time(nullptr);
  int retry = 0;
  while (now < 1000000000 && retry++ < 15) {
    delay(1000); Serial.print(".");
    now = time(nullptr);
    yield();
  }
  Serial.println(now > 1000000000 ? " OK" : " GAGAL");

  Serial.println("[SB] Loading settings...");
  fetchSettings();
  delay(2500);
  Serial.println("[SB] Loading nasabah...");
  fetchNasabah();
  delay(2000);
  Serial.println("[SB] Loading loker...");
  fetchLoker();
  delay(500);

  Serial.println("[SB] Restoring state...");
  restoreState();
  delay(500);

  timerCache   = millis();
  timerPollCmd = millis();

  buzzerBeep(100); delay(100); buzzerBeep(300);
  Serial.println("[SYSTEM] Ready! State: " + String(stateStr()) + "\n");
}

// ============================================================
//  LOOP
// ============================================================
void loop() {
  yield();

  if (millis() - timerCache > CACHE_REFRESH) {
    timerCache = millis();
    fetchSettings(); delay(1000);
    fetchNasabah();  delay(1000);
    fetchLoker();
    Serial.println("[CACHE] Refreshed");
  }

  if (millis() - timerPollCmd > POLL_INTERVAL) {
    timerPollCmd = millis();
    pollCommands();
  }

  switch (state) {
    case STANDBY:      loopStandby();      break;
    case PINTU_MASUK:  loopPintuMasuk();   break;
    case DI_DALAM:     loopDiDalam();      break;
    case BRANKAS_BUKA: loopBrankasBuka();  break;
    case PINTU_KELUAR: loopPintuKeluar();  break;
    case ALARM:        break;
  }
}

// ============================================================
//  STATE: STANDBY
// ============================================================
void loopStandby() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

  String uid = getUID();
  Serial.println("\n[RFID] Scan: " + uid);

  bool anomali   = !isJamKerja();
  Nasabah* found = cariNasabahRFID(uid);

  if (found == nullptr) {
    failRFID++;
    Serial.println("[RFID] Tidak terdaftar! Fail " + String(failRFID) + "/" + String(MAX_FAIL_RFID));
    buzzerDenied();
    logPintu("", "MASUK", true);
    if (failRFID >= MAX_FAIL_RFID) {
      triggerAlarm();
      failRFID = 0;
    }
  } else if (anomali) {
    Serial.println("[RFID] " + found->nama + " - DI LUAR JAM KERJA!");
    buzzerAlert();
    logPintu(found->id, "MASUK", true);
  } else {
    failRFID = 0;
    nasabahAktif = found;
    Serial.println("[RFID] Akses OK: " + found->nama);

    String logID = logPintuGetID(found->id, "MASUK", false);
    if (logID != "") {
      delay(HTTP_DELAY);
      triggerCameraCapture(logID);
    }

    bukaPintu();
    state = PINTU_MASUK;
    timerPintu = millis();
    Serial.println("[DOOR] Pintu terbuka " + String(DURASI_PINTU_BUKA/1000) + " detik, silakan masuk...");
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

// ============================================================
//  STATE: PINTU MASUK
// ============================================================
void loopPintuMasuk() {
  if (millis() - timerPintu >= DURASI_PINTU_BUKA) {
    tutupPintu();
    Serial.println("[DOOR] Pintu terkunci. Nasabah di dalam.");
    Serial.println("[FP] Tempelkan sidik jari untuk buka brankas...");
    state = DI_DALAM;
    timerDalam = millis();
    failFP = 0;
  }
}

// ============================================================
//  STATE: DI DALAM
// ============================================================
void loopDiDalam() {
  if (millis() - timerDalam > TIMEOUT_DI_DALAM) {
    Serial.println("[INSIDE] Timeout 30 menit! Auto keluar.");
    tutupBrankas();
    if (nasabahAktif) logPintu(nasabahAktif->id, "KELUAR", false);
    bukaPintu();
    state = PINTU_KELUAR;
    timerPintu = millis();
    return;
  }

  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    String uid = getUID();
    Nasabah* found = cariNasabahRFID(uid);
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();

    if (found != nullptr) {
      if (nasabahAktif && found->id == nasabahAktif->id) {
        Serial.println("[EXIT] " + found->nama + " minta keluar.");
        logPintu(found->id, "KELUAR", false);
        bukaPintu();
        state = PINTU_KELUAR;
        timerPintu = millis();
        return;
      } else {
        Serial.println("[SECURITY] DITOLAK! " + found->nama + " mencoba masuk.");
        buzzerDenied();
        logPintu(found->id, "MASUK", true);
      }
    } else {
      Serial.println("[INSIDE] Kartu tidak dikenal.");
      buzzerDenied();
    }
  }

  int fpID = scanFP();
  if (fpID == -2) return;

  Nasabah* n = cariNasabahFP(fpID);

  if (fpID > 0 && n != nullptr) {
    if (nasabahAktif && n->id == nasabahAktif->id) {
      failFP = 0;
      Serial.println("[FP] COCOK: " + n->nama + " (ID=" + String(fpID) + ")");
      Loker* l       = cariLoker(n->id);
      String lokerID = l ? l->id : "";
      String noLoker = l ? l->nomor_loker : "?";
      logLoker(n->id, lokerID, "BERHASIL");
      Serial.println("[FP] Loker: " + noLoker);
      bukaBrankas();
      state = BRANKAS_BUKA;
    } else {
      Serial.println("[SECURITY] ALARM! Sidik jari milik " + n->nama + " tapi yang masuk adalah " +
                     (nasabahAktif ? nasabahAktif->nama : "?") + "!");
      logLoker(n->id, "", "GAGAL");
      triggerAlarm();
      failFP = 0;
    }
  } else if (fpID == 0) {
    failFP++;
    Serial.println("[FP] Sidik jari tidak terdaftar! Fail " + String(failFP) + "/" + String(MAX_FAIL_FP));
    buzzerDenied();
    logLoker(nasabahAktif ? nasabahAktif->id : "", "", "GAGAL");
    if (failFP >= MAX_FAIL_FP) {
      Serial.println("[FP] ALARM! Terlalu banyak percobaan.");
      triggerAlarm();
      failFP = 0;
    }
  }
}

// ============================================================
//  STATE: BRANKAS BUKA
// ============================================================
void loopBrankasBuka() {
  if (millis() - timerDalam > TIMEOUT_DI_DALAM) {
    Serial.println("[INSIDE] Timeout 30 menit! Auto keluar.");
    tutupBrankas();
    if (nasabahAktif) logPintu(nasabahAktif->id, "KELUAR", false);
    bukaPintu();
    state = PINTU_KELUAR;
    timerPintu = millis();
    return;
  }

  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    String uid = getUID();
    Nasabah* found = cariNasabahRFID(uid);
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();

    if (found != nullptr) {
      if (nasabahAktif && found->id == nasabahAktif->id) {
        Serial.println("[EXIT] " + found->nama + " keluar, brankas dikunci.");
        tutupBrankas();
        delay(500);
        logPintu(found->id, "KELUAR", false);
        bukaPintu();
        state = PINTU_KELUAR;
        timerPintu = millis();
        return;
      } else {
        Serial.println("[SECURITY] DITOLAK! " + found->nama + " mencoba masuk.");
        buzzerDenied();
        logPintu(found->id, "MASUK", true);
      }
    } else {
      Serial.println("[INSIDE] Kartu tidak dikenal.");
      buzzerDenied();
    }
  }

  int fpID = scanFP();
  if (fpID == -2) return;
  Nasabah* n = cariNasabahFP(fpID);
  if (fpID > 0 && n != nullptr) {
    Serial.println("[FP] Brankas sudah terbuka untuk " + n->nama);
  }
}

// ============================================================
//  STATE: PINTU KELUAR
// ============================================================
void loopPintuKeluar() {
  if (millis() - timerPintu >= DURASI_PINTU_BUKA) {
    tutupPintu();
    Serial.println("[DOOR] Pintu terkunci. Selesai.");
    nasabahAktif = nullptr;
    failFP   = 0;
    failRFID = 0;
    state = STANDBY;
    buzzerBeep(300);
  }
}

// ============================================================
//  SUPABASE HTTP (BearSSL)
// ============================================================
String sbGET(String endpoint, int maxRetry) {
  if (WiFi.status() != WL_CONNECTED) return "";
  for (int attempt = 1; attempt <= maxRetry; attempt++) {
    std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure);
    client->setInsecure();
    HTTPClient http;
    http.begin(*client, String(SUPABASE_URL) + "/rest/v1/" + endpoint);
    http.setTimeout(HTTP_TIMEOUT);
    http.addHeader("apikey", SUPABASE_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
    http.addHeader("Connection", "close");
    int code = http.GET();
    if (code == 200) {
      String resp = http.getString();
      http.end();
      delay(HTTP_DELAY);
      return resp;
    }
    Serial.println("[SB] GET error " + String(code) + " attempt " + String(attempt));
    http.end();
    if (attempt < maxRetry) { delay(1500 * attempt); yield(); }
  }
  Serial.println("[SB] GET GAGAL");
  return "";
}

bool sbPOST(String endpoint, String body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure);
  client->setInsecure();
  HTTPClient http;
  http.begin(*client, String(SUPABASE_URL) + "/rest/v1/" + endpoint);
  http.setTimeout(HTTP_TIMEOUT);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");
  http.addHeader("Connection", "close");
  int code = http.POST(body);
  http.end();
  delay(HTTP_DELAY);
  if (code == 201) return true;
  Serial.println("[SB] POST error " + String(code));
  return false;
}

String sbPOSTGetBody(String endpoint, String body) {
  if (WiFi.status() != WL_CONNECTED) return "";
  std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure);
  client->setInsecure();
  HTTPClient http;
  http.begin(*client, String(SUPABASE_URL) + "/rest/v1/" + endpoint);
  http.setTimeout(HTTP_TIMEOUT);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=representation");
  http.addHeader("Connection", "close");
  int code = http.POST(body);
  String resp = "";
  if (code == 201) resp = http.getString();
  else Serial.println("[SB] POSTGetBody error " + String(code));
  http.end();
  delay(HTTP_DELAY);
  return resp;
}

bool sbPATCH(String endpoint, String body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure);
  client->setInsecure();
  HTTPClient http;
  http.begin(*client, String(SUPABASE_URL) + "/rest/v1/" + endpoint);
  http.setTimeout(HTTP_TIMEOUT);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");
  http.addHeader("Connection", "close");
  int code = http.PATCH(body);
  http.end();
  delay(HTTP_DELAY);
  if (code == 200 || code == 204) return true;
  Serial.println("[SB] PATCH error " + String(code));
  return false;
}

// ============================================================
//  FETCH DATA
// ============================================================
void fetchSettings() {
  String resp = sbGET("system_settings?select=jam_buka,jam_tutup&limit=1");
  if (resp == "") return;
  DynamicJsonDocument doc(256);
  if (deserializeJson(doc, resp)) return;
  JsonArray arr = doc.as<JsonArray>();
  if (arr.size() == 0) return;
  cfgJamBuka  = String(arr[0]["jam_buka"].as<String>()).substring(0,2).toInt();
  cfgJamTutup = String(arr[0]["jam_tutup"].as<String>()).substring(0,2).toInt();
  Serial.println("[SB] Jam kerja: " + String(cfgJamBuka) + ":00 - " + String(cfgJamTutup) + ":00");
}

void fetchNasabah() {
  String resp = sbGET("nasabah?select=id,nama,rfid_uid,fingerprint_id");
  if (resp == "") return;
  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, resp)) return;
  total_nasabah = 0;
  for (JsonObject o : doc.as<JsonArray>()) {
    if (total_nasabah >= MAX_NASABAH) break;
    db_nasabah[total_nasabah++] = {
      o["id"].as<String>(), o["nama"].as<String>(),
      o["rfid_uid"].as<String>(), o["fingerprint_id"].as<int>()
    };
  }
  Serial.println("[SB] Loaded " + String(total_nasabah) + " nasabah");
}

void fetchLoker() {
  String resp = sbGET("loker?select=id,nomor_loker,id_nasabah");
  if (resp == "") return;
  DynamicJsonDocument doc(2048);
  if (deserializeJson(doc, resp)) return;
  total_loker = 0;
  for (JsonObject o : doc.as<JsonArray>()) {
    if (total_loker >= MAX_LOKER) break;
    db_loker[total_loker++] = {
      o["id"].as<String>(), o["nomor_loker"].as<String>(), o["id_nasabah"].as<String>()
    };
  }
  Serial.println("[SB] Loaded " + String(total_loker) + " loker");
}

// ============================================================
//  RESTORE STATE (v4)
// ============================================================
void restoreState() {
  Serial.println("[STATE] Checking previous state...");
  String resp = sbGET(
    "log_pintu"
    "?select=id,tipe_akses,is_anomali,id_nasabah"
    "&order=waktu_akses.desc"
    "&limit=1"
  );
  if (resp == "" || resp == "[]") {
    Serial.println("[STATE] Tidak ada log sebelumnya → STANDBY");
    return;
  }
  DynamicJsonDocument doc(512);
  if (deserializeJson(doc, resp) != DeserializationError::Ok) {
    Serial.println("[STATE] Parse error → STANDBY");
    return;
  }
  JsonArray arr = doc.as<JsonArray>();
  if (arr.size() == 0) { Serial.println("[STATE] Array kosong → STANDBY"); return; }

  String tipe  = arr[0]["tipe_akses"].as<String>();
  bool anomali = arr[0]["is_anomali"].as<bool>();
  String idNas = arr[0]["id_nasabah"].as<String>();

  Serial.println("[STATE] Log terakhir: tipe=" + tipe +
                 " anomali=" + String(anomali ? "true" : "false") +
                 " id_nasabah=" + idNas);

  if (tipe != "MASUK" || anomali || idNas == "" || idNas == "null") {
    Serial.println("[STATE] Ruangan kosong → STANDBY");
    return;
  }

  for (int i = 0; i < total_nasabah; i++) {
    if (db_nasabah[i].id == idNas) {
      nasabahAktif = &db_nasabah[i];
      state        = DI_DALAM;
      timerDalam   = millis();
      failFP       = 0;
      Serial.println("[STATE] *** RESTORED: DI_DALAM ***");
      Serial.println("[STATE] Nasabah: " + nasabahAktif->nama);
      buzzerBeep(100); delay(100); buzzerBeep(100); delay(100); buzzerBeep(300);
      return;
    }
  }
  Serial.println("[STATE] WARN: id_nasabah tidak ditemukan di cache → STANDBY");
}

// ============================================================
//  LOG
// ============================================================
void logPintu(String idNasabah, String tipe, bool anomali) {
  String body = "{";
  if (idNasabah != "") body += "\"id_nasabah\":\"" + idNasabah + "\",";
  body += "\"tipe_akses\":\"" + tipe + "\",";
  body += "\"is_anomali\":" + String(anomali ? "true" : "false") + "}";
  bool ok = sbPOST("log_pintu", body);
  Serial.println("[LOG] Pintu " + tipe + " " + String(ok?"OK":"FAIL"));
}

String logPintuGetID(String idNasabah, String tipe, bool anomali) {
  String body = "{";
  if (idNasabah != "") body += "\"id_nasabah\":\"" + idNasabah + "\",";
  body += "\"tipe_akses\":\"" + tipe + "\",";
  body += "\"is_anomali\":" + String(anomali ? "true" : "false") + "}";
  String resp = sbPOSTGetBody("log_pintu", body);
  if (resp == "") return "";
  DynamicJsonDocument doc(512);
  if (deserializeJson(doc, resp)) return "";
  if (doc.as<JsonArray>().size() == 0) return "";
  String newID = doc[0]["id"].as<String>();
  Serial.println("[LOG] log_pintu ID: " + newID);
  return newID;
}

void logLoker(String idNasabah, String idLoker, String status) {
  String body = "{";
  if (idNasabah != "") body += "\"id_nasabah\":\"" + idNasabah + "\",";
  if (idLoker   != "") body += "\"id_loker\":\"" + idLoker + "\",";
  body += "\"status_akses\":\"" + status + "\"}";
  bool ok = sbPOST("log_loker", body);
  Serial.println("[LOG] Loker " + status + " " + String(ok?"OK":"FAIL"));
}

// ============================================================
//  COMMANDS — standar
// ============================================================
void triggerCameraCapture(String logPintuID) {
  String body = "{\"type\":\"CAPTURE_PHOTO\","
                "\"payload\":{\"log_pintu_id\":\"" + logPintuID + "\"},"
                "\"status\":\"pending\"}";
  bool ok = sbPOST("commands", body);
  Serial.println("[CMD] CAPTURE_PHOTO: " + String(ok?"OK":"FAIL"));
}

void markCommandDone(String cmdID) {
  bool ok = sbPATCH("commands?id=eq." + cmdID, "{\"status\":\"done\"}");
  Serial.println("[CMD] Done: " + String(ok?"OK":"FAIL"));
}

// ============================================================
//  COMMANDS — polling (v5: tambah ENROLL_RFID & ENROLL_FP)
// ============================================================
void pollCommands() {
  // [v5] select juga payload untuk command ENROLL
  String resp = sbGET(
    "commands"
    "?status=eq.pending"
    "&type=neq.CAPTURE_PHOTO"
    "&order=created_at.asc"
    "&limit=5"
    "&select=id,type,payload"
  );
  if (resp == "" || resp == "[]") return;

  DynamicJsonDocument doc(2048);
  if (deserializeJson(doc, resp)) return;
  JsonArray arr = doc.as<JsonArray>();
  if (arr.size() == 0) return;

  Serial.println("[POLL] " + String(arr.size()) + " command");

  for (JsonObject cmd : arr) {
    String type  = cmd["type"].as<String>();
    String cmdID = cmd["id"].as<String>();
    Serial.println("[POLL] Execute: " + type);

    bool selfHandled = false; // ENROLL commands manage their own status

    if (type == "LOCK_ALL") {
      tutupBrankas(); tutupPintu();
      if (nasabahAktif) logPintu(nasabahAktif->id, "KELUAR", false);
      nasabahAktif = nullptr; state = STANDBY;

    } else if (type == "RESET_ALARM") {
      state = STANDBY; failRFID = 0; failFP = 0;
      digitalWrite(BUZZER, LOW);

    } else if (type == "UNLOCK_DOOR") {
      bukaPintu(); state = PINTU_MASUK; timerPintu = millis();

    } else if (type == "REFRESH_CACHE") {
      fetchSettings(); delay(1000);
      fetchNasabah();  delay(1000);
      fetchLoker();    timerCache = millis();

    } else if (type == "ENROLL_RFID") {
      selfHandled = true;
      if (state != STANDBY) {
        Serial.println("[ENROLL] DITOLAK: bukan STANDBY");
        sbPATCH("commands?id=eq." + cmdID,
          "{\"status\":\"error\",\"payload\":{\"progress\":\"DITOLAK: Alat tidak dalam mode STANDBY.\"}}");
      } else {
        String nasabahId = cmd["payload"]["nasabah_id"] | String("");
        if (nasabahId == "" || nasabahId == "null") {
          sbPATCH("commands?id=eq." + cmdID,
            "{\"status\":\"error\",\"payload\":{\"progress\":\"GAGAL: nasabah_id tidak valid.\"}}");
        } else {
          handleEnrollRFID(cmdID, nasabahId);
        }
      }

    } else if (type == "ENROLL_FP") {
      selfHandled = true;
      if (state != STANDBY) {
        Serial.println("[ENROLL] DITOLAK: bukan STANDBY");
        sbPATCH("commands?id=eq." + cmdID,
          "{\"status\":\"error\",\"payload\":{\"progress\":\"DITOLAK: Alat tidak dalam mode STANDBY.\"}}");
      } else {
        String nasabahId = cmd["payload"]["nasabah_id"] | String("");
        int fpTargetId   = cmd["payload"]["fingerprint_id"] | 0;
        if (nasabahId == "" || nasabahId == "null") {
          sbPATCH("commands?id=eq." + cmdID,
            "{\"status\":\"error\",\"payload\":{\"progress\":\"GAGAL: nasabah_id tidak valid.\"}}");
        } else if (fpTargetId < 1 || fpTargetId > 127) {
          sbPATCH("commands?id=eq." + cmdID,
            "{\"status\":\"error\",\"payload\":{\"progress\":\"GAGAL: fingerprint_id harus 1-127.\"}}");
        } else {
          handleEnrollFP(cmdID, nasabahId, fpTargetId);
        }
      }
    }

    delay(300);
    if (!selfHandled) markCommandDone(cmdID);
  }
}

// ============================================================
//  [v5] ENROLL HELPERS
// ============================================================

// Kirim progress ke tabel commands (hanya update payload, status tetap pending)
void updateCmdProgress(String cmdID, String nasabahId, String msg, int fpId) {
  String pl = "{\"nasabah_id\":\"" + nasabahId + "\",\"progress\":\"" + msg + "\"";
  if (fpId > 0) pl += ",\"fingerprint_id\":" + String(fpId);
  pl += "}";
  sbPATCH("commands?id=eq." + cmdID, "{\"payload\":" + pl + "}");
}

// ── ENROLL RFID ──────────────────────────────────────────────
void handleEnrollRFID(String cmdID, String nasabahId) {
  Serial.println("[ENROLL_RFID] Mulai → nasabah: " + nasabahId);
  updateCmdProgress(cmdID, nasabahId, "Dekatkan kartu RFID ke sensor...", -1);
  buzzerBeep(100);

  // Tunggu kartu (timeout ENROLL_TIMEOUT_MS)
  unsigned long start = millis();
  String uid = "";
  while (millis() - start < ENROLL_TIMEOUT_MS) {
    yield();
    if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      uid = getUID();
      rfid.PICC_HaltA();
      rfid.PCD_StopCrypto1();
      break;
    }
    delay(100);
  }

  if (uid == "") {
    updateCmdProgress(cmdID, nasabahId, "TIMEOUT: Tidak ada kartu terdeteksi.", -1);
    sbPATCH("commands?id=eq." + cmdID, "{\"status\":\"error\"}");
    Serial.println("[ENROLL_RFID] Timeout");
    return;
  }

  Serial.println("[ENROLL_RFID] UID: " + uid);
  updateCmdProgress(cmdID, nasabahId, "Kartu terdeteksi: " + uid + ". Memvalidasi...", -1);

  // Cek duplikat — pastikan UID tidak terdaftar ke nasabah lain
  for (int i = 0; i < total_nasabah; i++) {
    if (db_nasabah[i].rfid_uid == uid && db_nasabah[i].id != nasabahId) {
      String errMsg = "GAGAL: UID " + uid + " sudah digunakan nasabah lain.";
      updateCmdProgress(cmdID, nasabahId, errMsg, -1);
      sbPATCH("commands?id=eq." + cmdID, "{\"status\":\"error\"}");
      Serial.println("[ENROLL_RFID] Duplikat UID: " + uid);
      return;
    }
  }

  // Simpan ke tabel nasabah
  bool ok = sbPATCH("nasabah?id=eq." + nasabahId, "{\"rfid_uid\":\"" + uid + "\"}");
  if (!ok) {
    updateCmdProgress(cmdID, nasabahId, "GAGAL menyimpan UID ke database.", -1);
    sbPATCH("commands?id=eq." + cmdID, "{\"status\":\"error\"}");
    return;
  }

  // Selesai — update command done + payload hasil
  String finalPl = "{\"nasabah_id\":\"" + nasabahId +
                   "\",\"progress\":\"Berhasil! RFID UID: " + uid + " tersimpan.\"" +
                   ",\"rfid_uid\":\"" + uid + "\"}";
  sbPATCH("commands?id=eq." + cmdID,
    "{\"status\":\"done\",\"payload\":" + finalPl + "}");

  fetchNasabah();
  buzzerBeep(100); delay(80); buzzerBeep(300);
  Serial.println("[ENROLL_RFID] Done: " + uid);
}

// ── ENROLL FINGERPRINT ───────────────────────────────────────
void handleEnrollFP(String cmdID, String nasabahId, int fpTargetId) {
  Serial.println("[ENROLL_FP] Mulai → ID=" + String(fpTargetId) + " nasabah=" + nasabahId);

  // ── Fase 1: scan jari pertama ──
  updateCmdProgress(cmdID, nasabahId, "Tempelkan jari Anda ke sensor...", fpTargetId);
  buzzerBeep(100);

  unsigned long start = millis();
  int p = -1;
  while (millis() - start < ENROLL_TIMEOUT_MS) {
    yield();
    p = finger.getImage();
    if (p == FINGERPRINT_OK) break;
    if (p == FINGERPRINT_NOFINGER) { delay(80); continue; }
    delay(100);
  }
  if (p != FINGERPRINT_OK) {
    updateCmdProgress(cmdID, nasabahId, "TIMEOUT: Tidak ada sidik jari terdeteksi.", fpTargetId);
    sbPATCH("commands?id=eq." + cmdID, "{\"status\":\"error\"}");
    return;
  }

  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) {
    updateCmdProgress(cmdID, nasabahId, "GAGAL: Kualitas gambar sidik jari buruk. Coba lagi.", fpTargetId);
    sbPATCH("commands?id=eq." + cmdID, "{\"status\":\"error\"}");
    return;
  }
  Serial.println("[ENROLL_FP] Gambar 1 OK");
  buzzerBeep(200);

  // ── Fase 2: angkat jari ──
  updateCmdProgress(cmdID, nasabahId, "Angkat jari Anda dari sensor...", fpTargetId);
  delay(1000);
  start = millis();
  while (millis() - start < 10000) {
    yield();
    if (finger.getImage() == FINGERPRINT_NOFINGER) break;
    delay(80);
  }

  // ── Fase 3: scan jari kedua ──
  updateCmdProgress(cmdID, nasabahId, "Tempelkan jari yang SAMA lagi...", fpTargetId);
  buzzerBeep(100);

  start = millis();
  p = -1;
  while (millis() - start < ENROLL_TIMEOUT_MS) {
    yield();
    p = finger.getImage();
    if (p == FINGERPRINT_OK) break;
    if (p == FINGERPRINT_NOFINGER) { delay(80); continue; }
    delay(100);
  }
  if (p != FINGERPRINT_OK) {
    updateCmdProgress(cmdID, nasabahId, "TIMEOUT: Scan jari kedua gagal.", fpTargetId);
    sbPATCH("commands?id=eq." + cmdID, "{\"status\":\"error\"}");
    return;
  }

  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) {
    updateCmdProgress(cmdID, nasabahId, "GAGAL: Kualitas gambar jari kedua buruk.", fpTargetId);
    sbPATCH("commands?id=eq." + cmdID, "{\"status\":\"error\"}");
    return;
  }
  Serial.println("[ENROLL_FP] Gambar 2 OK");

  // ── Buat model & simpan ──
  updateCmdProgress(cmdID, nasabahId, "Memproses & menyimpan sidik jari...", fpTargetId);

  p = finger.createModel();
  if (p == FINGERPRINT_ENROLLMISMATCH) {
    updateCmdProgress(cmdID, nasabahId, "GAGAL: Dua sidik jari tidak cocok. Ulangi proses.", fpTargetId);
    sbPATCH("commands?id=eq." + cmdID, "{\"status\":\"error\"}");
    return;
  }
  if (p != FINGERPRINT_OK) {
    updateCmdProgress(cmdID, nasabahId, "GAGAL: Tidak dapat membuat model sidik jari.", fpTargetId);
    sbPATCH("commands?id=eq." + cmdID, "{\"status\":\"error\"}");
    return;
  }

  p = finger.storeModel(fpTargetId);
  if (p != FINGERPRINT_OK) {
    updateCmdProgress(cmdID, nasabahId, "GAGAL menyimpan ke sensor fingerprint.", fpTargetId);
    sbPATCH("commands?id=eq." + cmdID, "{\"status\":\"error\"}");
    return;
  }
  Serial.println("[ENROLL_FP] Stored ID=" + String(fpTargetId));

  // Simpan fingerprint_id ke tabel nasabah
  bool ok = sbPATCH("nasabah?id=eq." + nasabahId,
                    "{\"fingerprint_id\":" + String(fpTargetId) + "}");
  if (!ok) {
    updateCmdProgress(cmdID, nasabahId, "GAGAL menyimpan fingerprint_id ke database.", fpTargetId);
    sbPATCH("commands?id=eq." + cmdID, "{\"status\":\"error\"}");
    return;
  }

  // Selesai
  String finalPl = "{\"nasabah_id\":\"" + nasabahId +
                   "\",\"fingerprint_id\":" + String(fpTargetId) +
                   ",\"progress\":\"Berhasil! Sidik jari ID #" + String(fpTargetId) + " tersimpan.\"}";
  sbPATCH("commands?id=eq." + cmdID,
    "{\"status\":\"done\",\"payload\":" + finalPl + "}");

  fetchNasabah();
  buzzerBeep(100); delay(80); buzzerBeep(100); delay(80); buzzerBeep(300);
  Serial.println("[ENROLL_FP] Done ID=" + String(fpTargetId));
}

// ============================================================
//  LOOKUP
// ============================================================
Nasabah* cariNasabahRFID(String uid) {
  for (int i = 0; i < total_nasabah; i++)
    if (db_nasabah[i].rfid_uid == uid) return &db_nasabah[i];
  return nullptr;
}
Nasabah* cariNasabahFP(int fpID) {
  for (int i = 0; i < total_nasabah; i++)
    if (db_nasabah[i].fingerprint_id == fpID) return &db_nasabah[i];
  return nullptr;
}
Loker* cariLoker(String idNasabah) {
  for (int i = 0; i < total_loker; i++)
    if (db_loker[i].id_nasabah == idNasabah) return &db_loker[i];
  return nullptr;
}

// ============================================================
//  JAM KERJA
// ============================================================
bool isJamKerja() {
  time_t now = time(nullptr);
  if (now < 1000000000) return true;
  struct tm* t = localtime(&now);
  return (t->tm_hour >= cfgJamBuka && t->tm_hour < cfgJamTutup);
}

// ============================================================
//  HARDWARE
// ============================================================
void bukaPintu()    { servoPintu.write(90);   buzzerBeep(200); Serial.println("[HW] Pintu BUKA"); }
void tutupPintu()   { servoPintu.write(0);    Serial.println("[HW] Pintu KUNCI"); }
void bukaBrankas()  { servoBrankas.write(90); buzzerBeep(100); delay(80); buzzerBeep(100); Serial.println("[HW] Brankas BUKA"); }
void tutupBrankas() { servoBrankas.write(0);  Serial.println("[HW] Brankas KUNCI"); }

void triggerAlarm() {
  State prevState = state;
  state = ALARM;
  Serial.println("[ALARM] !!!");
  unsigned long s = millis();
  while (millis() - s < 5000) {
    digitalWrite(BUZZER, HIGH); delay(200);
    digitalWrite(BUZZER, LOW);  delay(200);
    yield();
  }
  state = prevState;
  digitalWrite(BUZZER, LOW);
}

void buzzerBeep(int d)  { digitalWrite(BUZZER,HIGH); delay(d); digitalWrite(BUZZER,LOW); }
void buzzerDenied()     { for(int i=0;i<3;i++){buzzerBeep(100);delay(100);} }
void buzzerAlert()      { for(int i=0;i<2;i++){buzzerBeep(400);delay(200);} }
void buzzerError()      { buzzerBeep(1500); }

// ============================================================
//  RFID & FP
// ============================================================
String getUID() {
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  return uid;
}

int scanFP() {
  if (finger.getImage() != FINGERPRINT_OK) return -2;
  if (finger.image2Tz()  != FINGERPRINT_OK) return -1;
  if (finger.fingerFastSearch() == FINGERPRINT_OK) {
    Serial.println("[FP] ID=" + String(finger.fingerID) + " confidence=" + String(finger.confidence));
    return finger.fingerID;
  }
  return 0;
}

// ============================================================
//  WiFi
// ============================================================
void connectWiFi() {
  Serial.print("[WiFi] Connecting to " + String(WIFI_SSID));
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int i = 0; WiFi.status() != WL_CONNECTED && i < 20; i++) {
    delay(500); Serial.print("."); yield();
  }
  Serial.println(WiFi.status() == WL_CONNECTED ?
    "\n[WiFi] IP: " + WiFi.localIP().toString() : "\n[WiFi] GAGAL!");
}

const char* stateStr() {
  switch(state) {
    case STANDBY:      return "STANDBY";
    case PINTU_MASUK:  return "DOOR_ENTRY";
    case DI_DALAM:     return "INSIDE";
    case BRANKAS_BUKA: return "VAULT_OPEN";
    case PINTU_KELUAR: return "DOOR_EXIT";
    case ALARM:        return "ALARM";
    default:           return "UNKNOWN";
  }
}
