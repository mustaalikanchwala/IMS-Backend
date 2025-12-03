-- Create products table
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) UNIQUE,
  price DECIMAL(10, 2),
  stock INTEGER DEFAULT 0,
  shopify_product_id BIGINT,
  shopify_variant_id BIGINT,
  shopify_inventory_item_id BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX idx_shopify_product_id ON products(shopify_product_id);
CREATE INDEX idx_sku ON products(sku);
