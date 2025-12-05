/**
 * ============================================================================
 * SHOPIFY INTEGRATION ROUTES
 * ============================================================================
 * 
 * Provides utility endpoints for Shopify synchronization and management.
 * These routes handle manual operations, testing, and bulk import tasks.
 * 
 * Key Features:
 * - Connection testing and diagnostics
 * - Location management
 * - Product synchronization (single and bulk)
 * - Stock management
 * - Shopify ID retrieval
 * 
 * Use Cases:
 * - Initial setup and configuration
 * - Importing existing Shopify products
 * - Manual sync operations
 * - Debugging and troubleshooting
 * 
 * @module routes/shopifyRoutes
 * @requires express
 * @requires ../services/shopifyService
 * @requires ../config/database
 * 
 * @author Your Name
 * @version 2.0.0
 * @since 2025-12-06
 * ============================================================================
 */

import express from 'express';
import shopifyService from '../services/shopifyService.js';
import db from '../config/database.js';

const router = express.Router();

// ============================================================================
// DIAGNOSTIC & TESTING ENDPOINTS
// ============================================================================

/**
 * ----------------------------------------------------------------------------
 * Test Shopify API Connection
 * ----------------------------------------------------------------------------
 * 
 * Verifies that the Shopify API credentials are valid and the connection
 * is working properly. Use this endpoint during initial setup to ensure
 * environment variables are configured correctly.
 * 
 * Test Checklist:
 * 1. SHOPIFY_STORE_URL is correct
 * 2. SHOPIFY_ACCESS_TOKEN is valid
 * 3. API can reach Shopify servers
 * 4. Store has at least one location
 * 
 * @route GET /api/shopify/test
 * @access Public (should be protected in production)
 * @returns {Object} 200 - Success response with store info and locations
 * @returns {Object} 500 - Error response with failure details
 * 
 * @example
 * // Success Response:
 * {
 *   "success": true,
 *   "message": "Shopify API connected successfully!",
 *   "store": "your-store.myshopify.com",
 *   "api_version": "2024-01",
 *   "locations": [
 *     { "id": 84848959893, "name": "Main Warehouse" }
 *   ]
 * }
 */
router.get('/test', async (req, res) => {
  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧪 [TEST] Testing Shopify API Connection');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Validate environment variables
    if (!process.env.SHOPIFY_STORE_URL) {
      throw new Error('SHOPIFY_STORE_URL not configured');
    }
    
    if (!process.env.SHOPIFY_ACCESS_TOKEN) {
      throw new Error('SHOPIFY_ACCESS_TOKEN not configured');
    }
    
    // Test API call
    const locations = await shopifyService.getLocations();
    
    console.log('✅ Connection successful!');
    console.log(`   Store: ${process.env.SHOPIFY_STORE_URL}`);
    console.log(`   Locations found: ${locations.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    res.json({
      success: true,
      message: 'Shopify API connected successfully!',
      store: process.env.SHOPIFY_STORE_URL,
      api_version: process.env.SHOPIFY_API_VERSION || '2024-01',
      locations: locations.map(loc => ({
        id: loc.id,
        name: loc.name,
        active: loc.active
      })),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [TEST] Connection failed');
    console.error(`   Error: ${error.message}`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    res.status(500).json({
      success: false,
      error: 'Shopify API connection failed',
      message: error.message,
      troubleshooting: [
        'Verify SHOPIFY_STORE_URL format: your-store.myshopify.com',
        'Check SHOPIFY_ACCESS_TOKEN is valid and not expired',
        'Ensure custom app has required permissions',
        'Confirm store is not in development mode'
      ]
    });
  }
});

// ============================================================================
// LOCATION MANAGEMENT
// ============================================================================

/**
 * ----------------------------------------------------------------------------
 * Get All Store Locations
 * ----------------------------------------------------------------------------
 * 
 * Retrieves all physical and virtual locations (warehouses, stores, etc.)
 * configured in your Shopify store. Locations are required for inventory
 * management operations.
 * 
 * Common Use Cases:
 * - Getting location ID for environment variable setup
 * - Multi-warehouse inventory management
 * - Store pickup configuration
 * 
 * @route GET /api/shopify/locations
 * @access Public (should be protected in production)
 * @returns {Object} 200 - Success response with locations array
 * @returns {Object} 500 - Error response
 * 
 * @example
 * // Response:
 * {
 *   "success": true,
 *   "count": 2,
 *   "locations": [
 *     {
 *       "id": 84848959893,
 *       "name": "Main Warehouse",
 *       "address1": "123 Storage St",
 *       "city": "New York",
 *       "active": true
 *     }
 *   ]
 * }
 */
router.get('/locations', async (req, res) => {
  try {
    console.log('📍 [LOCATIONS] Fetching store locations...');
    
    const locations = await shopifyService.getLocations();
    
    console.log(`✅ Found ${locations.length} location(s)\n`);
    
    res.json({
      success: true,
      count: locations.length,
      locations: locations,
      primary_location: locations.length > 0 ? locations[0] : null
    });
    
  } catch (error) {
    console.error('❌ [LOCATIONS] Failed to fetch locations');
    console.error(`   Error: ${error.message}\n`);
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch locations',
      message: error.message
    });
  }
});

// ============================================================================
// PRODUCT INFORMATION RETRIEVAL
// ============================================================================

/**
 * ----------------------------------------------------------------------------
 * Get All Required IDs for a Product
 * ----------------------------------------------------------------------------
 * 
 * Retrieves comprehensive ID information for a Shopify product.
 * This is a diagnostic endpoint useful for:
 * - Debugging synchronization issues
 * - Manual configuration
 * - Understanding Shopify's ID structure
 * 
 * ID Types Explained:
 * - Product ID: Identifies the product (e.g., "T-Shirt")
 * - Variant ID: Identifies specific variant (e.g., "Red/Large")
 * - Inventory Item ID: Used for stock management
 * - Location ID: Identifies warehouse/store
 * 
 * @route GET /api/shopify/product-ids/:productId
 * @access Public (should be protected in production)
 * @param {string} productId - Shopify product ID
 * @returns {Object} 200 - Complete ID information
 * @returns {Object} 404 - Product not found
 * @returns {Object} 500 - Server error
 * 
 * @example
 * // Request: GET /api/shopify/product-ids/9199278194901
 * // Response:
 * {
 *   "success": true,
 *   "ids": {
 *     "product_id": "9199278194901",
 *     "variant_id": "52772972560597",
 *     "inventory_item_id": "54878322032853",
 *     "location_id": "84848959893"
 *   },
 *   "current_stock": {
 *     "available": 50
 *   }
 * }
 */
router.get('/product-ids/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔍 [IDs] Fetching IDs for product ${productId}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Fetch product from Shopify
    const product = await shopifyService.getProduct(productId);
    
    if (!product) {
      throw new Error(`Product ${productId} not found in Shopify`);
    }
    
    // Get first variant (most products have at least one)
    const variant = product.variants[0];
    
    if (!variant) {
      throw new Error('Product has no variants');
    }
    
    // Fetch store locations
    const locations = await shopifyService.getLocations();
    
    if (locations.length === 0) {
      throw new Error('No locations found in store');
    }
    
    const primaryLocation = locations[0];
    
    // Try to fetch current inventory level
    let inventoryLevel = null;
    try {
      inventoryLevel = await shopifyService.getInventoryLevel(
        variant.inventory_item_id,
        primaryLocation.id
      );
    } catch (inventoryError) {
      console.warn(`⚠️  Could not fetch inventory level: ${inventoryError.message}`);
    }
    
    const result = {
      success: true,
      message: 'All IDs retrieved successfully',
      ids: {
        product_id: product.id.toString(),
        variant_id: variant.id.toString(),
        inventory_item_id: variant.inventory_item_id.toString(),
        location_id: primaryLocation.id.toString(),
        location_name: primaryLocation.name
      },
      current_stock: {
        shopify_inventory_quantity: variant.inventory_quantity || 0,
        inventory_level_available: inventoryLevel?.available || 0,
        match: (variant.inventory_quantity === inventoryLevel?.available)
      },
      product_info: {
        title: product.title,
        sku: variant.sku || 'N/A',
        price: variant.price,
        status: product.status
      }
    };
    
    console.log('✅ IDs retrieved successfully');
    console.log('   Product ID:', result.ids.product_id);
    console.log('   Variant ID:', result.ids.variant_id);
    console.log('   Inventory Item ID:', result.ids.inventory_item_id);
    console.log('   Location ID:', result.ids.location_id);
    console.log('   Current Stock:', result.current_stock.inventory_level_available);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ [IDs] Failed to fetch product IDs');
    console.error(`   Error: ${error.message}\n`);
    
    const statusCode = error.message.includes('not found') ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: 'Failed to fetch product IDs',
      message: error.message
    });
  }
});

// ============================================================================
// PRODUCT SYNCHRONIZATION
// ============================================================================

/**
 * ----------------------------------------------------------------------------
 * Sync Single Product from Shopify to Database
 * ----------------------------------------------------------------------------
 * 
 * Fetches a product from Shopify and synchronizes it with your database.
 * This is useful for:
 * - Importing existing Shopify products
 * - Manual sync after data inconsistencies
 * - Initial database population
 * 
 * Behavior:
 * - If product exists in DB: Updates all fields
 * - If product doesn't exist: Creates new entry
 * - Handles all variants automatically
 * 
 * Database Impact:
 * - Inserts/Updates: products table
 * - Inserts/Updates: product_variants table
 * 
 * @route POST /api/shopify/sync-product/:productId
 * @access Public (should be protected in production)
 * @param {string} productId - Shopify product ID
 * @returns {Object} 200 - Success with synced product data
 * @returns {Object} 404 - Product not found in Shopify
 * @returns {Object} 500 - Sync failed
 * 
 * @example
 * // Request: POST /api/shopify/sync-product/9199278194901
 * // Response:
 * {
 *   "success": true,
 *   "action": "created",
 *   "product": {
 *     "id": 1,
 *     "shopify_product_id": "9199278194901",
 *     "name": "iPhone 15 Pro",
 *     "variants": [...]
 *   }
 * }
 */
router.post('/sync-product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔄 [SYNC] Syncing product ${productId} from Shopify`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Fetch product data from Shopify
    const productData = await shopifyService.syncProductFromShopify(productId);
    
    // Check if product exists in database
    const existingProduct = await db.query(
      'SELECT id, name FROM products WHERE shopify_product_id = $1',
      [productData.shopify_product_id]
    );
    
    let dbProductId;
    let action;
    
    if (existingProduct.rows.length > 0) {
      // Product exists - update it
      dbProductId = existingProduct.rows[0].id;
      action = 'updated';
      
      console.log(`   Product exists in DB (ID: ${dbProductId})`);
      
      await db.query(
        `UPDATE products 
         SET name = $1, 
             description = $2, 
             product_type = $3, 
             vendor = $4, 
             status = $5, 
             updated_at = CURRENT_TIMESTAMP
         WHERE shopify_product_id = $6`,
        [
          productData.name,
          productData.description,
          productData.product_type,
          productData.vendor,
          productData.status,
          productData.shopify_product_id
        ]
      );
      
      console.log('   ✅ Product updated');
      
    } else {
      // Product doesn't exist - create it
      action = 'created';
      
      console.log('   Product not found - creating new entry');
      
      const insertResult = await db.query(
        `INSERT INTO products 
         (shopify_product_id, name, description, product_type, vendor, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          productData.shopify_product_id,
          productData.name,
          productData.description,
          productData.product_type,
          productData.vendor,
          productData.status
        ]
      );
      
      dbProductId = insertResult.rows[0].id;
      console.log(`   ✅ Product created (ID: ${dbProductId})`);
    }
    
    // Sync all variants
    const syncedVariants = [];
    let variantsCreated = 0;
    let variantsUpdated = 0;
    
    for (const variant of productData.variants) {
      const existingVariant = await db.query(
        'SELECT id FROM product_variants WHERE shopify_variant_id = $1',
        [variant.shopify_variant_id]
      );
      
      let dbVariant;
      
      if (existingVariant.rows.length > 0) {
        // Update existing variant
        const updateResult = await db.query(
          `UPDATE product_variants 
           SET sku = $1, title = $2, option1 = $3, option2 = $4, option3 = $5,
               price = $6, compare_at_price = $7, stock = $8, 
               weight = $9, weight_unit = $10, 
               shopify_inventory_item_id = $11,
               updated_at = CURRENT_TIMESTAMP
           WHERE shopify_variant_id = $12
           RETURNING *`,
          [
            variant.sku,
            variant.title,
            variant.option1,
            variant.option2,
            variant.option3,
            variant.price,
            variant.compare_at_price,
            variant.stock,
            variant.weight,
            variant.weight_unit,
            variant.shopify_inventory_item_id,
            variant.shopify_variant_id
          ]
        );
        
        dbVariant = updateResult.rows[0];
        variantsUpdated++;
        
      } else {
        // Create new variant
        const insertResult = await db.query(
          `INSERT INTO product_variants 
           (product_id, shopify_variant_id, shopify_inventory_item_id, 
            sku, title, option1, option2, option3, 
            price, compare_at_price, stock, weight, weight_unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING *`,
          [
            dbProductId,
            variant.shopify_variant_id,
            variant.shopify_inventory_item_id,
            variant.sku,
            variant.title,
            variant.option1,
            variant.option2,
            variant.option3,
            variant.price,
            variant.compare_at_price,
            variant.stock,
            variant.weight,
            variant.weight_unit
          ]
        );
        
        dbVariant = insertResult.rows[0];
        variantsCreated++;
      }
      
      syncedVariants.push(dbVariant);
    }
    
    console.log(`   ✅ Variants synced (${variantsCreated} created, ${variantsUpdated} updated)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Fetch complete product with variants for response
    const productResult = await db.query(
      `SELECT 
        p.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', v.id,
              'shopify_variant_id', v.shopify_variant_id,
              'sku', v.sku,
              'title', v.title,
              'price', v.price,
              'stock', v.stock
            ) ORDER BY v.id
          ) FILTER (WHERE v.id IS NOT NULL),
          '[]'
        ) as variants
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id
      WHERE p.id = $1
      GROUP BY p.id`,
      [dbProductId]
    );
    
    res.json({
      success: true,
      message: `Product ${action} successfully`,
      action: action,
      variants_created: variantsCreated,
      variants_updated: variantsUpdated,
      product: productResult.rows[0]
    });
    
  } catch (error) {
    console.error('❌ [SYNC] Sync failed');
    console.error(`   Error: ${error.message}`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const statusCode = error.message.includes('not found') ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: 'Failed to sync product from Shopify',
      message: error.message
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * Bulk Sync All Products from Shopify
 * ----------------------------------------------------------------------------
 * 
 * Imports ALL products from Shopify into your database in a single operation.
 * This is a heavy operation - use for:
 * - Initial database setup
 * - Complete data reset/refresh
 * - Recovering from data loss
 * 
 * Performance Notes:
 * - Fetches up to 250 products per request (Shopify limit)
 * - Processes sequentially to avoid rate limits
 * - May take several minutes for large catalogs
 * 
 * Safety Features:
 * - Updates existing products instead of failing
 * - Continues on individual product errors
 * - Provides detailed summary of results
 * 
 * @route POST /api/shopify/sync-all-products
 * @access Protected (admin only - implement authentication)
 * @returns {Object} 200 - Success with sync summary
 * @returns {Object} 500 - Sync failed
 * 
 * @example
 * // Response:
 * {
 *   "success": true,
 *   "summary": {
 *     "total": 150,
 *     "created": 120,
 *     "updated": 25,
 *     "failed": 5
 *   },
 *   "duration": "45.2s"
 * }
 * 
 * @warning This endpoint can take several minutes to complete.
 *          Implement proper timeout handling on frontend.
 */
router.post('/sync-all-products', async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 [BULK SYNC] Starting bulk product sync');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Fetch all products from Shopify (max 250 per page)
    const response = await shopifyService.api.get('/products.json?limit=250');
    const products = response.data.products;
    
    console.log(`📦 Found ${products.length} product(s) in Shopify`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors = [];
    
    // Process each product
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      
      try {
        console.log(`[${i + 1}/${products.length}] Processing: ${product.title}`);
        
        // Check if product exists
        const existingProduct = await db.query(
          'SELECT id FROM products WHERE shopify_product_id = $1',
          [product.id]
        );
        
        let dbProductId;
        
        if (existingProduct.rows.length > 0) {
          // Update existing
          dbProductId = existingProduct.rows[0].id;
          
          await db.query(
            `UPDATE products 
             SET name = $1, description = $2, product_type = $3, 
                 vendor = $4, status = $5, updated_at = CURRENT_TIMESTAMP
             WHERE shopify_product_id = $6`,
            [
              product.title,
              product.body_html,
              product.product_type,
              product.vendor,
              product.status,
              product.id
            ]
          );
          
          updated++;
          console.log(`   ✅ Updated (DB ID: ${dbProductId})`);
          
        } else {
          // Create new
          const insertResult = await db.query(
            `INSERT INTO products 
             (shopify_product_id, name, description, product_type, vendor, status)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [
              product.id,
              product.title,
              product.body_html,
              product.product_type,
              product.vendor,
              product.status
            ]
          );
          
          dbProductId = insertResult.rows[0].id;
          created++;
          console.log(`   ✅ Created (DB ID: ${dbProductId})`);
        }
        
        // Sync variants
        for (const variant of product.variants) {
          const existingVariant = await db.query(
            'SELECT id FROM product_variants WHERE shopify_variant_id = $1',
            [variant.id]
          );
          
          if (existingVariant.rows.length > 0) {
            // Update variant
            await db.query(
              `UPDATE product_variants 
               SET sku = $1, title = $2, option1 = $3, option2 = $4, option3 = $5,
                   price = $6, compare_at_price = $7, stock = $8, 
                   weight = $9, weight_unit = $10,
                   shopify_inventory_item_id = $11,
                   updated_at = CURRENT_TIMESTAMP
               WHERE shopify_variant_id = $12`,
              [
                variant.sku,
                variant.title,
                variant.option1,
                variant.option2,
                variant.option3,
                parseFloat(variant.price),
                variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
                parseInt(variant.inventory_quantity) || 0,
                variant.weight,
                variant.weight_unit,
                variant.inventory_item_id,
                variant.id
              ]
            );
          } else {
            // Create variant
            await db.query(
              `INSERT INTO product_variants 
               (product_id, shopify_variant_id, shopify_inventory_item_id, 
                sku, title, option1, option2, option3, 
                price, compare_at_price, stock, weight, weight_unit)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              [
                dbProductId,
                variant.id,
                variant.inventory_item_id,
                variant.sku || `SKU-${variant.id}`,
                variant.title,
                variant.option1,
                variant.option2,
                variant.option3,
                parseFloat(variant.price),
                variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
                parseInt(variant.inventory_quantity) || 0,
                variant.weight,
                variant.weight_unit
              ]
            );
          }
        }
        
        console.log(`   📦 ${product.variants.length} variant(s) synced\n`);
        
      } catch (productError) {
        failed++;
        const errorMsg = `Failed to sync product ${product.id}: ${productError.message}`;
        errors.push(errorMsg);
        console.error(`   ❌ ${errorMsg}\n`);
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ [BULK SYNC] Sync completed');
    console.log(`   Total: ${products.length}`);
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Duration: ${duration}s`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    res.json({
      success: true,
      message: 'Bulk sync completed',
      summary: {
        total: products.length,
        created,
        updated,
        failed,
        success_rate: `${(((created + updated) / products.length) * 100).toFixed(1)}%`
      },
      duration: `${duration}s`,
      errors: errors.length > 0 ? errors : undefined
    });
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.error('❌ [BULK SYNC] Sync failed');
    console.error(`   Error: ${error.message}`);
    console.error(`   Duration: ${duration}s`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    res.status(500).json({
      success: false,
      error: 'Bulk sync failed',
      message: error.message,
      duration: `${duration}s`
    });
  }
});

// ============================================================================
// STOCK MANAGEMENT
// ============================================================================

/**
 * ----------------------------------------------------------------------------
 * Update Stock on Shopify
 * ----------------------------------------------------------------------------
 * 
 * Updates inventory quantity for a product variant on Shopify.
 * Also updates the local database to maintain sync.
 * 
 * Use Cases:
 * - Manual stock adjustments
 * - Receiving new inventory
 * - Stock corrections
 * 
 * Important Notes:
 * - Requires inventory_item_id (not variant_id)
 * - Requires location_id
 * - Sets exact quantity (not relative adjustment)
 * 
 * @route POST /api/shopify/update-stock/:variantId
 * @access Protected (should require authentication)
 * @param {string} variantId - Internal variant ID from database
 * @param {Object} req.body - Request body
 * @param {number} req.body.stock - New stock quantity (must be >= 0)
 * @param {string} [req.body.locationId] - Location ID (uses default if not provided)
 * @returns {Object} 200 - Success with updated stock
 * @returns {Object} 400 - Invalid input
 * @returns {Object} 404 - Variant not found
 * @returns {Object} 500 - Update failed
 * 
 * @example
 * // Request: POST /api/shopify/update-stock/5
 * // Body: { "stock": 100 }
 * // Response:
 * {
 *   "success": true,
 *   "message": "Stock updated successfully",
 *   "variant": {
 *     "id": 5,
 *     "sku": "NIKE-RED-9",
 *     "stock": 100
 *   }
 * }
 */
router.post('/update-stock/:variantId', async (req, res) => {
  try {
    const { variantId } = req.params;
    const { stock, locationId } = req.body;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 [STOCK] Updating stock for variant ${variantId}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Validate input
    if (stock === undefined || stock === null) {
      return res.status(400).json({
        success: false,
        error: 'Stock quantity is required'
      });
    }
    
    if (stock < 0) {
      return res.status(400).json({
        success: false,
        error: 'Stock quantity cannot be negative'
      });
    }
    
    // Get variant from database
    const variantResult = await db.query(
      'SELECT * FROM product_variants WHERE id = $1',
      [variantId]
    );
    
    if (variantResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Variant not found in database'
      });
    }
    
    const variant = variantResult.rows[0];
    
    if (!variant.shopify_inventory_item_id) {
      return res.status(400).json({
        success: false,
        error: 'Variant missing Shopify inventory item ID',
        message: 'Variant may not be properly synced with Shopify'
      });
    }
    
    // Determine location
    const location = locationId || await shopifyService.getDefaultLocationId();
    
    console.log(`   Variant: ${variant.sku}`);
    console.log(`   Old Stock: ${variant.stock}`);
    console.log(`   New Stock: ${stock}`);
    console.log(`   Location: ${location}`);
    
    // Update stock on Shopify
    await shopifyService.updateInventory(
      variant.shopify_inventory_item_id,
      location,
      stock
    );
    
    console.log('   ✅ Shopify updated');
    
    // Update stock in database
    const updatedVariant = await db.query(
      `UPDATE product_variants 
       SET stock = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING *`,
      [stock, variantId]
    );
    
    console.log('   ✅ Database updated');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    res.json({
      success: true,
      message: 'Stock updated successfully on both systems',
      old_stock: variant.stock,
      new_stock: stock,
      variant: updatedVariant.rows[0]
    });
    
  } catch (error) {
    console.error('❌ [STOCK] Update failed');
    console.error(`   Error: ${error.message}`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    res.status(500).json({
      success: false,
      error: 'Failed to update stock',
      message: error.message
    });
  }
});

// ============================================================================
// EXPORTS
// ============================================================================

export default router;
