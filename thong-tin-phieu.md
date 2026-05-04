https://your-odoo-instance.odoo.com/jsonrpc

{
  "jsonrpc": "2.0",
  "method": "call",
  "params": {
    "service": "object",
    "method": "execute_kw",
    "args": [
      "your_database_name",
      0,
      "replace_with_your_odoo_api_key",
      "stock.picking",
      "search_read",
      [[["name", "=", "PICKING_CODE"]]],
      {
        "fields": [
          "name",
          "origin",
          "state",
          "partner_id",
          "picking_type_id",
          "location_id",
          "location_dest_id",
          "scheduled_date",
          "date_done",
          "user_id"
        ]
      }
    ]
  },
  "id": 1
}
