import express from 'express';
import db from '../config/database.js';
import shopifyService from '../services/shopifyService.js';

const router = express.Router();

// ===== VALIDATION MIDDLEWARE =====
const validateProductData = (req, res, next) => {
  const { name, price } = req.body;
  
  if (!name || name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Product name is required'
    });
  }
  
  if (price !== undefined && (isNaN(price) || price < 0)) {
    return res.status(400).json({
      success: false,
      error: 'Valid price is required (must be a positive number)'
    });
  }
  
  next();
};

const validateVariantData = (req, res, next) => {
  const { sku, price, stock } = req.body;
  
  if (!sku || sku.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'SKU is required for variant'
    });
  }
  
  if (price === undefined || isNaN(price) || price < 0) {
    return res.status(400).json({
      success: false,
      error: 'Valid price is required'
    });
  }
  
  if (stock !== undefined && (isNaN(stock) || stock < 0)) {
    return res.status(400).json({
      success: false,
      error: 'Stock must be a positive number'
    });
  }
  
  next();
};

// ===== GET ALL PRODUCTS WITH VARIANTS =====
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0, status, search } = req.query;
    
    // Build query dynamically
    let query = `
      SELECT 
        p.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', v.id,
              'shopify_variant_id', v.shopify_variant_id,
              'sku', v.sku,
              'title', v.title,
              'option1', v.option1,
              'option2', v.option2,
              'option3', v.option3,
              'price', v.price,
              'compare_at_price', v.compare_at_price,
              'stock', v.stock,
              'image_url', v.image_url
            ) ORDER BY v.id
          ) FILTER (WHERE v.id IS NOT NULL),
          '[]'
        ) as variants
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    // Filter by status
    if (status) {
      query += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    // Search by name
    if (search) {
      query += ` AND p.name ILIKE $${paramIndex}`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    query += `
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await db.query(query, params);
    
    // Get total count
    const countResult = await db.query(
      'SELECT COUNT(*) FROM products WHERE 1=1' + 
      (status ? ' AND status = $1' : ''),
      status ? [status] : []
    );
    
    res.json({
      success: true,
      count: result.rows.length,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
      products: result.rows
    });
    
  } catch (error) {
    console.error('❌ Error fetching products:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products',
      message: error.message
    });
  }
});

// ===== GET PRODUCT BY SHOPIFY PRODUCT ID =====
router.get('/shopify/:shopifyProductId', async (req, res) => {
  try {
    const { shopifyProductId } = req.params;
    
    const result = await db.query(
      `SELECT 
        p.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', v.id,
              'shopify_variant_id', v.shopify_variant_id,
              'shopify_inventory_item_id', v.shopify_inventory_item_id,
              'sku', v.sku,
              'title', v.title,
              'option1', v.option1,
              'option2', v.option2,
              'option3', v.option3,
              'price', v.price,
              'compare_at_price', v.compare_at_price,
              'stock', v.stock,
              'weight', v.weight,
              'weight_unit', v.weight_unit,
              'image_url', v.image_url,
              'created_at', v.created_at,
              'updated_at', v.updated_at
            ) ORDER BY v.id
          ) FILTER (WHERE v.id IS NOT NULL),
          '[]'
        ) as variants
      FROM products p
      LEFT JOIN product_variants v ON p.id = v.product_id
      WHERE p.shopify_product_id = $1
      GROUP BY p.id`,
      [shopifyProductId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
        shopify_product_id: shopifyProductId
      });
    }
    
    res.json({
      success: true,
      product: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error fetching product:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product',
      message: error.message
    });
  }
});

// ===== GET SPECIFIC VARIANT BY SHOPIFY VARIANT ID =====
router.get('/shopify/:shopifyProductId/variants/:shopifyVariantId', async (req, res) => {
  try {
    const { shopifyProductId, shopifyVariantId } = req.params;
    
    const result = await db.query(
      `SELECT v.*, p.name as product_name, p.shopify_product_id
       FROM product_variants v
       JOIN products p ON v.product_id = p.id
       WHERE p.shopify_product_id = $1 AND v.shopify_variant_id = $2`,
      [shopifyProductId, shopifyVariantId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Variant not found',
        shopify_product_id: shopifyProductId,
        shopify_variant_id: shopifyVariantId
      });
    }
    
    res.json({
      success: true,
      variant: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error fetching variant:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch variant',
      message: error.message
    });
  }
});

// ===== CREATE PRODUCT WITH VARIANTS =====
router.post('/', validateProductData, async (req, res) => {
  try {
    const { 
      name, 
      description, 
      product_type, 
      vendor, 
      variants = [], 
      syncToShopify = true 
    } = req.body;
    
    // Validate at least one variant
    if (variants.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one variant is required'
      });
    }
    
    // Validate all variants
    for (const variant of variants) {
      if (!variant.sku || !variant.price) {
        return res.status(400).json({
          success: false,
          error: 'Each variant must have SKU and price'
        });
      }
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('➕ Creating new product:', name);
    console.log('   Variants:', variants.length);
    console.log('   Sync to Shopify:', syncToShopify);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    let shopifyProductData = null;
    
    // Step 1: Create in Shopify (if enabled)
    if (syncToShopify) {
      try {
        console.log('📤 Creating product in Shopify...');
        
        shopifyProductData = await shopifyService.createProduct({
          name,
          description,
          vendor: vendor || 'Default Vendor',
          productType: product_type || 'General',
          variants: variants.map(v => ({
            sku: v.sku,
            price: parseFloat(v.price),
            stock: parseInt(v.stock) || 0,
            title: v.title || 'Default',
            option1: v.option1 || null,
            option2: v.option2 || null,
            option3: v.option3 || null,
            weight: v.weight || null,
            weightUnit: v.weight_unit || 'kg'
          }))
        });
        
        console.log('✅ Product created in Shopify');
        console.log('   Shopify Product ID:', shopifyProductData.shopify_product_id);
        
      } catch (shopifyError) {
        console.error('⚠️ Failed to create in Shopify:', shopifyError.message);
        console.log('📝 Will create in database only');
        // Continue to create in database even if Shopify fails
      }
    }
    
    // Step 2: Create product in database
    console.log('📝 Creating product in database...');
    
    const productResult = await db.query(
      `INSERT INTO products 
       (shopify_product_id, name, description, product_type, vendor, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        shopifyProductData?.shopify_product_id || null,
        name,
        description || null,
        product_type || 'General',
        vendor || 'Default Vendor',
        'active'
      ]
    );
    
    const createdProduct = productResult.rows[0];
    console.log('✅ Product created in database (ID:', createdProduct.id, ')');
    
    // Step 3: Create variants in database
    console.log('📝 Creating variants in database...');
    
    const createdVariants = [];
    
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      const shopifyVariant = shopifyProductData?.variants[i] || {};
      
      const variantResult = await db.query(
        `INSERT INTO product_variants 
         (product_id, shopify_variant_id, shopify_inventory_item_id, 
          sku, title, option1, option2, option3, 
          price, compare_at_price, stock, weight, weight_unit, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          createdProduct.id,
          shopifyVariant.shopify_variant_id || null,
          shopifyVariant.shopify_inventory_item_id || null,
          variant.sku,
          variant.title || 'Default',
          variant.option1 || null,
          variant.option2 || null,
          variant.option3 || null,
          parseFloat(variant.price),
          variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
          parseInt(variant.stock) || 0,
          variant.weight ? parseFloat(variant.weight) : null,
          variant.weight_unit || 'kg',
          variant.image_url || null
        ]
      );
      
      createdVariants.push(variantResult.rows[0]);
    }
    
    console.log(`✅ Created ${createdVariants.length} variant(s) in database`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Step 4: Return complete product data
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      synced_to_shopify: !!shopifyProductData,
      product: {
        ...createdProduct,
        variants: createdVariants
      }
    });
    
  } catch (error) {
    console.error('❌ Error creating product:', error.message);
    console.error('Error details:', error);
    
    // Handle duplicate SKU
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'Duplicate SKU or Shopify ID',
        message: error.detail
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to create product',
      message: error.message
    });
  }
});

// ===== UPDATE VARIANT BY SHOPIFY IDS =====
router.patch('/shopify/:shopifyProductId/variants/:shopifyVariantId', validateVariantData, async (req, res) => {
  try {
    const { shopifyProductId, shopifyVariantId } = req.params;
    const { price, stock, compare_at_price, weight, image_url, syncToShopify = true } = req.body;
    
    // Get existing variant
    const existingVariant = await db.query(
      `SELECT v.*, p.shopify_product_id
       FROM product_variants v
       JOIN products p ON v.product_id = p.id
       WHERE p.shopify_product_id = $1 AND v.shopify_variant_id = $2`,
      [shopifyProductId, shopifyVariantId]
    );
    
    if (existingVariant.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Variant not found'
      });
    }
    
    const variant = existingVariant.rows[0];
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 Updating variant:', variant.sku);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Update stock in Shopify if needed
    if (syncToShopify && stock !== undefined && variant.shopify_inventory_item_id) {
      try {
        const locationId = process.env.SHOPIFY_LOCATION_ID;
        await shopifyService.updateInventory(
          variant.shopify_inventory_item_id,
          locationId,
          stock
        );
        console.log('✅ Stock updated in Shopify');
      } catch (shopifyError) {
        console.error('⚠️ Failed to update Shopify:', shopifyError.message);
      }
    }
    
    // Update in database
    const result = await db.query(
      `UPDATE product_variants
       SET price = COALESCE($1, price),
           stock = COALESCE($2, stock),
           compare_at_price = COALESCE($3, compare_at_price),
           weight = COALESCE($4, weight),
           image_url = COALESCE($5, image_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [price, stock, compare_at_price, weight, image_url, variant.id]
    );
    
    console.log('✅ Variant updated in database');
    
    res.json({
      success: true,
      message: 'Variant updated successfully',
      variant: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Error updating variant:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update variant',
      message: error.message
    });
  }
});

// ===== DELETE PRODUCT BY SHOPIFY ID =====
router.delete('/shopify/:shopifyProductId', async (req, res) => {
  try {
    const { shopifyProductId } = req.params;
    const { syncToShopify = true } = req.query;
    
    // Get product
    const productResult = await db.query(
      'SELECT * FROM products WHERE shopify_product_id = $1',
      [shopifyProductId]
    );
    
    if (productResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }
    
    const product = productResult.rows[0];
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🗑️ Deleting product:', product.name);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Delete from Shopify
    if (syncToShopify === 'true') {
      try {
        await shopifyService.deleteProduct(shopifyProductId);
        console.log('✅ Product deleted from Shopify');
      } catch (shopifyError) {
        console.error('⚠️ Failed to delete from Shopify:', shopifyError.message);
      }
    }
    
    // Delete from database (CASCADE will delete variants)
    await db.query('DELETE FROM products WHERE shopify_product_id = $1', [shopifyProductId]);
    
    console.log('✅ Product and variants deleted from database');
    
    res.json({
      success: true,
      message: 'Product and all variants deleted successfully'
    });
    
  } catch (error) {
    console.error('❌ Error deleting product:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to delete product',
      message: error.message
    });
  }
});

export default router;
