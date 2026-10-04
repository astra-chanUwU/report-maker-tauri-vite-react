package controlplane

import (
	"fmt"
	"os"
	"strconv"
)

// ProductPlan is server-owned catalog data; prices and entitlements are never taken from clients.
type ProductPlan struct {
	ID          string
	Name        string
	Description string
	PriceRials  int64
	Features    map[string]bool
	MaxDevices  int
}

var productCatalog = map[string]ProductPlan{
	"perpetual": {
		ID:          "perpetual",
		Name:        "Perpetual",
		Description: "Core report creation and export for one major version.",
		PriceRials:  defaultPerpetualPriceRials(),
		Features:    map[string]bool{"core_export": true, "hosted_ai": true},
		MaxDevices:  3,
	},
}

func defaultPerpetualPriceRials() int64 {
	value := int64(1_000_000)
	if raw := os.Getenv("REPORT_PERPETUAL_PRICE_RIALS"); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil && parsed > 0 {
			value = parsed
		}
	}
	return value
}

func PlanFromCatalog(id string) (ProductPlan, bool) {
	plan, ok := productCatalog[id]
	if !ok {
		return ProductPlan{}, false
	}
	// Copy so env-driven price changes are picked up for the perpetual plan.
	if id == "perpetual" {
		plan.PriceRials = defaultPerpetualPriceRials()
	}
	return plan, true
}

func catalogPlansForView() []PlanView {
	views := make([]PlanView, 0, len(productCatalog))
	for _, plan := range productCatalog {
		if plan.ID == "perpetual" {
			plan.PriceRials = defaultPerpetualPriceRials()
		}
		views = append(views, PlanView{
			ID:          plan.ID,
			Name:        plan.Name,
			Description: plan.Description,
			Price:       formatRials(plan.PriceRials),
		})
	}
	return views
}

func formatRials(amount int64) string {
	return fmt.Sprintf("%d rials", amount)
}
