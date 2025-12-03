import express from 'express';
import shopifyService from '../services/shopifyService.js';
import db from '../config/database.js';

const router = express.Router();

// Test Shopify connection
router.get('/test', async (req, res) => {
  try {
    const locations = await shopifyService.getLocations();
    
    res.json({
      success: true,
      message: 'Shopify API connected successfully!',
      store: process.env.SHOPIFY_STORE_URL,
      locations: locations
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Shopify API connection failed',
      details: error.message
    });
  }
});

// Get locations
router.get('/locations', async (req, res) => {
  try {
    const locations = await shopifyService.getLocations();
    
    res.json({
      success: true,
      locations: locations
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch locations',
      details: error.message
    });
  }
});

// Get all required IDs for a product (NEW - THIS WAS MISSING!)
router.get('/product-ids/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    
    console.log(`🔍 Fetching all IDs for product ${productId}...`);
    
    // Get product details
    const product = await shopifyService.getProduct(productId);
    const variant = product.variants[0]; // First variant
    
    // Get locations
    const locations = await shopifyService.getLocations();
    const primaryLocation = locations[0];
    
    // Get current inventory level
    let inventoryLevel = null;
    try {
      inventoryLevel = await shopifyService.getInventoryLevel(
        variant.inventory_item_id,
        primaryLocation.id
      );
    } catch (error) {
      console.log('⚠️ Could not fetch inventory level:', error.message);
    }
    
    const result = {
      success: true,
      message: 'All IDs fetched successfully',
      ids: {
        product_id: product.id,
        variant_id: variant.id,
        inventory_item_id: variant.inventory_item_id,
        location_id: primaryLocation.id,
        location_name: primaryLocation.name
      },
      current_stock: {
        shopify_quantity: variant.inventory_quantity,
        inventory_level_available: inventoryLevel?.available || null
      },
      product_info: {
        title: product.title,
        sku: variant.sku,
        price: variant.price
      }
    };
    
    console.log('✅ All IDs retrieved!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📦 Product ID:', result.ids.product_id);
    console.log('🔢 Variant ID:', result.ids.variant_id);
    console.log('📊 Inventory Item ID:', result.ids.inventory_item_id);
    console.log('📍 Location ID:', result.ids.location_id);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error fetching product IDs:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product IDs',
      details: error.message
    });
  }
});

// Fetch product from Shopify and save to database
router.post('/sync-product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    
    console.log(`📥 Fetching product ${productId} from Shopify...`);
    
    // Get product details from Shopify
    const productData = await shopifyService.syncProductFromShopify(productId);
    
    // Check if product already exists in database (by shopify_product_id OR sku)
    const existingProduct = await db.query(
      'SELECT * FROM products WHERE shopify_product_id = $1 OR sku = $2',
      [productData.shopify_product_id, productData.sku]
    );
    
    let result;
    
    if (existingProduct.rows.length > 0) {
      // Update existing product
      console.log(`🔄 Product exists (ID: ${existingProduct.rows[0].id}), updating...`);
      
      result = await db.query(
        `UPDATE products 
         SET name = $1, sku = $2, price = $3, stock = $4, 
             shopify_product_id = $5, shopify_variant_id = $6, 
             shopify_inventory_item_id = $7, updated_at = CURRENT_TIMESTAMP
         WHERE id = $8
         RETURNING *`,
        [
          productData.name,
          productData.sku,
          productData.price,
          productData.stock,
          productData.shopify_product_id,
          productData.shopify_variant_id,
          productData.shopify_inventory_item_id,
          existingProduct.rows[0].id
        ]
      );
      
      console.log('✅ Product updated in database');
      
      res.json({
        success: true,
        message: 'Product updated successfully (already existed)',
        action: 'updated',
        product: result.rows[0]
      });
      
    } else {
      // Insert new product
      console.log('➕ New product, inserting...');
      
      result = await db.query(
        `INSERT INTO products 
         (name, sku, price, stock, shopify_product_id, shopify_variant_id, shopify_inventory_item_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          productData.name,
          productData.sku,
          productData.price,
          productData.stock,
          productData.shopify_product_id,
          productData.shopify_variant_id,
          productData.shopify_inventory_item_id
        ]
      );
      
      console.log('✅ Product added to database');
      
      res.json({
        success: true,
        message: 'Product synced from Shopify successfully',
        action: 'created',
        product: result.rows[0]
      });
    }
    
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to sync product from Shopify',
      details: error.message
    });
  }
});

// Update stock on Shopify (Direction 2: Your System → Shopify)
router.post('/update-stock/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { stock, locationId } = req.body;
    
    if (stock === undefined || stock < 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid stock quantity is required'
      });
    }
    
    // Get product from database
    const productResult = await db.query(
      'SELECT * FROM products WHERE id = $1',
      [productId]
    );
    
    if (productResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Product not found in database'
      });
    }
    
    const product = productResult.rows[0];
    
    if (!product.shopify_inventory_item_id) {
      return res.status(400).json({
        success: false,
        error: 'Product missing Shopify inventory item ID'
      });
    }
    
    const location = locationId || process.env.SHOPIFY_LOCATION_ID;
    
    if (!location) {
      return res.status(400).json({
        success: false,
        error: 'Location ID is required. Please fetch locations first.'
      });
    }
    
    console.log(`📤 Updating Shopify stock for product ${productId}...`);
    
    // Update stock on Shopify
    await shopifyService.updateInventory(
      product.shopify_inventory_item_id,
      location,
      stock
    );
    
    // Update stock in your database
    const updatedProduct = await db.query(
      `UPDATE products 
       SET stock = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING *`,
      [stock, productId]
    );
    
    console.log('✅ Stock synced: Database + Shopify');
    
    res.json({
      success: true,
      message: 'Stock updated on both systems',
      product: updatedProduct.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Stock update failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update stock on Shopify',
      details: error.message
    });
  }
});

export default router;
