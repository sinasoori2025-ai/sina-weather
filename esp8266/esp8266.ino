#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <DHT.h>

#define DHT_PIN D2
#define DHT_TYPE DHT11

const char* WIFI_SSID = "Tiger_Plus";
const char* WIFI_PASSWORD = "reza@sinamas55";

ESP8266WebServer server(80);
DHT dht(DHT_PIN, DHT_TYPE);

unsigned long lastRead = 0;
float temperature = NAN;
float humidity = NAN;

void readSensor() {
  if (millis() - lastRead >= 2000 || lastRead == 0) {
    lastRead = millis();

    float t = dht.readTemperature();
    float h = dht.readHumidity();

    if (!isnan(t) && !isnan(h)) {
      temperature = t;
      humidity = h;
    }
  }
}

void handleRoot() {
  server.send(
    200,
    "text/plain",
    "SINA WEATHER - ESP8266 ONLINE"
  );
}

void handleData() {
  readSensor();

  String json = "{";
  json += "\"device\":\"ESP8266\",";
  json += "\"temperature\":";

  if (isnan(temperature)) {
    json += "null";
  } else {
    json += String(temperature, 1);
  }

  json += ",\"humidity\":";

  if (isnan(humidity)) {
    json += "null";
  } else {
    json += String(humidity, 1);
  }

  json += ",\"pressure\":null";
  json += ",\"rainfall\":null";
  json += ",\"windSpeed\":null";
  json += ",\"uvIndex\":null";
  json += ",\"visibility\":null";
  json += "}";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}

void handleNotFound() {
  server.send(404, "text/plain", "Not Found");
}

void setup() {
  Serial.begin(115200);

  dht.begin();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.println();
  Serial.println("SINA WEATHER");
  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi Connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  server.on("/", HTTP_GET, handleRoot);
  server.on("/api/data", HTTP_GET, handleData);
  server.onNotFound(handleNotFound);

  server.begin();

  Serial.println("Web Server Started");
}

void loop() {
  server.handleClient();
  readSensor();
}