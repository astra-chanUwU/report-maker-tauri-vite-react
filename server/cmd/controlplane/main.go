package main

import (
	"log"
	"net/http"
	"os"
	cp "reportmaker/controlplane"
)

func main() {
	address := os.Getenv("HTTP_ADDR")
	if address == "" {
		address = ":8080"
	}
	app, err := cp.NewApp(cp.ConfigFromEnv())
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Report Maker control plane listening on %s", address)
	log.Fatal(http.ListenAndServe(address, app.Handler()))
}
