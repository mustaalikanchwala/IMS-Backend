import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * ShopifyService - Production-ready service for Shopify API interactions
 * Handles products, variants, and inventory management with proper error handling
 */
class ShopifyService {
  constructor() {
    // Validate required environment variables
    this.validateConfig();
    
    this.shopifyStore = process.env.SHOPIFY_STORE_URL;
    this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    this.apiVersion = process.env.SHOPIFY_API_VERSION || '2024-01';
    this.defaultLocationId = process.env.SHOPIFY_LOCATION_ID;
    
    // Create axios instance with Shopify configuration
    this.api = axios.create({
      baseURL: `https://${this.shopifyStore}/admin/api/${this.apiVersion}`,
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json'
      },
      timeout: 15000, // 15 second timeout
      validateStatus: (status) => status < 500 // Don't throw on 4xx errors
    });
    
    // Add request/response interceptors for logging and error handling
    this.setupInterceptors();
  }

  /**
   * Validate required environment variables
   */
  validateConfig() {
    const required = ['SHOPIFY_STORE_URL', 'SHOPIFY_ACCESS_TOKEN'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  /**
   * Setup axios interceptors for request/response handling
   */
  setupInterceptors() {
    // Request interceptor
    this.api.interceptors.request.use(
      (config) => {
        console.log(`🔹 Shopify API Request: ${config.method.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('❌ Request setup error:', error.message);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.api.interceptors.response.use(
      (response) => {
        // Check for Shopify rate limit headers
        const callLimit = response.headers['x-shopify-shop-api-call-limit'];
        if (callLimit) {
          const [used, total] = callLimit.split('/');
          if (parseInt(used) > parseInt(total) * 0.8) {
            console.warn(`⚠️ API rate limit approaching: ${callLimit}`);
          }
        }
        return response;
      },
      (error) => {
        this.handleApiError(error);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Handle API errors with proper logging
   */
  handleApiError(error) {
    if (error.response) {
      const { status, data } = error.response;
      console.error(`❌ Shopify API Error [${status}]:`, data);
      
      if (status === 429) {
        console.error('⚠️ Rate limit exceeded. Please wait before retrying.');
      } else if (status === 401) {
        console.error('⚠️ Authentication failed. Check access token.');
      } else if (status === 404) {
        console.error('⚠️ Resource not found.');
      }
    } else if (error.request) {
      console.error('❌ No response from Shopify:', error.message);
    } else {
      console.error('❌ Request error:', error.message);
    }
  }

  /**
   * Retry helper for rate-limited requests
   */
  async retryWithBackoff(fn, retries = 3, delay = 1000) {
    try {
      return await fn();
    } catch (error) {
      if (retries > 0 && error.response?.status === 429) {
        console.log(`⏳ Rate limited. Retrying in ${delay}ms... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.retryWithBackoff(fn, retries - 1, delay * 2);
      }
      throw error;
    }
  }

  // ===== LOCATION METHODS =====

  /**
   * Get all store locations
   * @returns {Promise<Array>} Array of location objects
   */
  async getLocations() {
    try {
      const response = await this.api.get('/locations.json');
      
      if (response.status !== 200) {
        throw new Error(`Failed to fetch locations: ${response.status}`);
      }
      
      console.log(`✅ Fetched ${response.data.locations.length} location(s)`);
      return response.data.locations;
    } catch (error) {
      console.error('❌ Error fetching locations');
      throw new Error('Failed to fetch Shopify locations');
    }
  }

  /**
   * Get default location ID
   * @returns {Promise<string>} Location ID
   */
  async getDefaultLocationId() {
    if (this.defaultLocationId) {
      return this.defaultLocationId;
    }
    
    const locations = await this.getLocations();
    if (locations.length === 0) {
      throw new Error('No locations found in Shopify store');
    }
    
    return locations[0].id.toString();
  }

  // ===== PRODUCT METHODS =====

  /**
   * Get product by ID from Shopify
   * @param {string|number} productId - Shopify product ID
   * @returns {Promise<Object>} Product object with variants
   */
  async getProduct(productId) {
    try {
      const response = await this.retryWithBackoff(async () => {
        return await this.api.get(`/products/${productId}.json`);
      });
      
      if (response.status === 404) {
        throw new Error(`Product ${productId} not found`);
      }
      
      if (response.status !== 200) {
        throw new Error(`Failed to fetch product: ${response.status}`);
      }
      
      console.log(`✅ Fetched product: ${response.data.product.title}`);
      return response.data.product;
    } catch (error) {
      console.error(`❌ Error fetching product ${productId}`);
      throw new Error(`Failed to fetch product ${productId}`);
    }
  }

  /**
   * Create product in Shopify with variants
   * @param {Object} productData - Product data
   * @returns {Promise<Object>} Created product with IDs
   */
  async createProduct(productData) {
    try {
      const { name, description, vendor, productType, variants = [] } = productData;
      
      // Validate required fields
      if (!name) {
        throw new Error('Product name is required');
      }
      
      // Build variants array
      const shopifyVariants = variants.length > 0 
        ? variants.map(v => ({
            title: v.title || 'Default',
            price: v.price.toString(),
            sku: v.sku,
            inventory_management: 'shopify',
            inventory_quantity: v.stock || 0,
            option1: v.option1 || null,
            option2: v.option2 || null,
            option3: v.option3 || null,
            weight: v.weight || null,
            weight_unit: v.weightUnit || 'kg'
          }))
        : [{
            title: 'Default',
            price: productData.price?.toString() || '0',
            sku: productData.sku || `SKU-${Date.now()}`,
            inventory_management: 'shopify',
            inventory_quantity: productData.stock || 0
          }];
      
      const shopifyProduct = {
        product: {
          title: name,
          body_html: description || '',
          vendor: vendor || 'Default Vendor',
          product_type: productType || 'General',
          variants: shopifyVariants,
          status: 'active'
        }
      };

      console.log(`📤 Creating product in Shopify: ${name}`);
      
      const response = await this.retryWithBackoff(async () => {
        return await this.api.post('/products.json', shopifyProduct);
      });
      
      if (response.status !== 201) {
        throw new Error(`Failed to create product: ${response.status}`);
      }
      
      const createdProduct = response.data.product;
      
      console.log(`✅ Product created: ${createdProduct.title}`);
      console.log(`   Product ID: ${createdProduct.id}`);
      console.log(`   Variants: ${createdProduct.variants.length}`);
      
      return {
        shopify_product_id: createdProduct.id,
        variants: createdProduct.variants.map(v => ({
          shopify_variant_id: v.id,
          shopify_inventory_item_id: v.inventory_item_id,
          sku: v.sku,
          price: v.price,
          title: v.title
        }))
      };
      
    } catch (error) {
      console.error('❌ Error creating product in Shopify');
      throw new Error(`Failed to create product: ${error.message}`);
    }
  }

  /**
   * Update product in Shopify
   * @param {string|number} productId - Shopify product ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated product
   */
  async updateProduct(productId, updateData) {
    try {
      const { name, description, vendor, productType, status } = updateData;
      
      const shopifyProduct = {
        product: {
          id: parseInt(productId)
        }
      };
      
      // Only include fields that are being updated
      if (name) shopifyProduct.product.title = name;
      if (description !== undefined) shopifyProduct.product.body_html = description;
      if (vendor) shopifyProduct.product.vendor = vendor;
      if (productType) shopifyProduct.product.product_type = productType;
      if (status) shopifyProduct.product.status = status;

      console.log(`📤 Updating product ${productId} in Shopify`);
      
      const response = await this.retryWithBackoff(async () => {
        return await this.api.put(`/products/${productId}.json`, shopifyProduct);
      });
      
      if (response.status !== 200) {
        throw new Error(`Failed to update product: ${response.status}`);
      }
      
      console.log('✅ Product updated in Shopify');
      return response.data.product;
      
    } catch (error) {
      console.error(`❌ Error updating product ${productId}`);
      throw new Error('Failed to update product in Shopify');
    }
  }

  /**
   * Delete product from Shopify
   * @param {string|number} productId - Shopify product ID
   */
  async deleteProduct(productId) {
    try {
      console.log(`🗑️ Deleting product ${productId} from Shopify`);
      
      const response = await this.retryWithBackoff(async () => {
        return await this.api.delete(`/products/${productId}.json`);
      });
      
      if (response.status !== 200 && response.status !== 204) {
        throw new Error(`Failed to delete product: ${response.status}`);
      }
      
      console.log('✅ Product deleted from Shopify');
      
    } catch (error) {
      console.error(`❌ Error deleting product ${productId}`);
      throw new Error('Failed to delete product from Shopify');
    }
  }

  // ===== VARIANT METHODS =====

  /**
   * Update variant in Shopify
   * @param {string|number} variantId - Shopify variant ID
   * @param {Object} updateData - Variant data to update
   * @returns {Promise<Object>} Updated variant
   */
  async updateVariant(variantId, updateData) {
    try {
      const { price, sku, option1, option2, option3, weight } = updateData;
      
      const shopifyVariant = {
        variant: {
          id: parseInt(variantId)
        }
      };
      
      // Only include fields being updated
      if (price !== undefined) shopifyVariant.variant.price = price.toString();
      if (sku) shopifyVariant.variant.sku = sku;
      if (option1) shopifyVariant.variant.option1 = option1;
      if (option2) shopifyVariant.variant.option2 = option2;
      if (option3) shopifyVariant.variant.option3 = option3;
      if (weight !== undefined) shopifyVariant.variant.weight = weight;

      console.log(`📤 Updating variant ${variantId} in Shopify`);
      
      const response = await this.retryWithBackoff(async () => {
        return await this.api.put(`/variants/${variantId}.json`, shopifyVariant);
      });
      
      if (response.status !== 200) {
        throw new Error(`Failed to update variant: ${response.status}`);
      }
      
      console.log('✅ Variant updated in Shopify');
      return response.data.variant;
      
    } catch (error) {
      console.error(`❌ Error updating variant ${variantId}`);
      throw new Error('Failed to update variant in Shopify');
    }
  }

  // ===== INVENTORY METHODS =====

  /**
   * Get inventory level for a specific item and location
   * @param {string|number} inventoryItemId - Inventory item ID
   * @param {string|number} locationId - Location ID (optional, uses default if not provided)
   * @returns {Promise<Object>} Inventory level object
   */
  async getInventoryLevel(inventoryItemId, locationId = null) {
    try {
      const location = locationId || await this.getDefaultLocationId();
      
      const response = await this.api.get('/inventory_levels.json', {
        params: {
          inventory_item_ids: inventoryItemId,
          location_ids: location
        }
      });
      
      if (response.status !== 200) {
        throw new Error(`Failed to fetch inventory level: ${response.status}`);
      }
      
      if (response.data.inventory_levels.length === 0) {
        throw new Error('Inventory level not found');
      }
      
      const level = response.data.inventory_levels[0];
      console.log(`✅ Current stock: ${level.available} units`);
      
      return level;
    } catch (error) {
      console.error('❌ Error fetching inventory level');
      throw new Error('Failed to fetch inventory level');
    }
  }

  /**
   * Set inventory to exact quantity
   * @param {string|number} inventoryItemId - Inventory item ID
   * @param {string|number} locationId - Location ID
   * @param {number} quantity - New stock quantity
   * @returns {Promise<Object>} Updated inventory level
   */
  async updateInventory(inventoryItemId, locationId, quantity) {
    try {
      const location = locationId || await this.getDefaultLocationId();
      
      const response = await this.retryWithBackoff(async () => {
        return await this.api.post('/inventory_levels/set.json', {
          location_id: parseInt(location),
          inventory_item_id: parseInt(inventoryItemId),
          available: parseInt(quantity)
        });
      });
      
      if (response.status !== 200) {
        throw new Error(`Failed to update inventory: ${response.status}`);
      }
      
      console.log(`✅ Inventory updated to ${quantity} units`);
      return response.data.inventory_level;
      
    } catch (error) {
      console.error('❌ Error updating inventory');
      throw new Error(`Failed to update inventory: ${error.message}`);
    }
  }

  /**
   * Adjust inventory by relative amount (add or subtract)
   * @param {string|number} inventoryItemId - Inventory item ID
   * @param {string|number} locationId - Location ID
   * @param {number} adjustment - Amount to adjust (positive or negative)
   * @returns {Promise<Object>} Updated inventory level
   */
  async adjustInventory(inventoryItemId, locationId, adjustment) {
    try {
      const location = locationId || await this.getDefaultLocationId();
      
      const response = await this.retryWithBackoff(async () => {
        return await this.api.post('/inventory_levels/adjust.json', {
          location_id: parseInt(location),
          inventory_item_id: parseInt(inventoryItemId),
          available_adjustment: parseInt(adjustment)
        });
      });
      
      if (response.status !== 200) {
        throw new Error(`Failed to adjust inventory: ${response.status}`);
      }
      
      const action = adjustment > 0 ? 'increased' : 'decreased';
      console.log(`✅ Inventory ${action} by ${Math.abs(adjustment)} units`);
      
      return response.data.inventory_level;
      
    } catch (error) {
      console.error('❌ Error adjusting inventory');
      throw new Error('Failed to adjust inventory');
    }
  }

  // ===== SYNC METHODS =====

  /**
   * Sync complete product data from Shopify (with all variants)
   * @param {string|number} productId - Shopify product ID
   * @returns {Promise<Object>} Product data formatted for database
   */
  async syncProductFromShopify(productId) {
    try {
      const product = await this.getProduct(productId);
      
      return {
        shopify_product_id: product.id,
        name: product.title,
        description: product.body_html,
        product_type: product.product_type,
        vendor: product.vendor,
        status: product.status,
        variants: product.variants.map(v => ({
          shopify_variant_id: v.id,
          shopify_inventory_item_id: v.inventory_item_id,
          sku: v.sku,
          title: v.title,
          option1: v.option1,
          option2: v.option2,
          option3: v.option3,
          price: parseFloat(v.price),
          compare_at_price: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
          stock: v.inventory_quantity || 0,
          weight: v.weight,
          weight_unit: v.weight_unit,
          image_url: v.image_id ? product.images.find(img => img.id === v.image_id)?.src : null
        }))
      };
      
    } catch (error) {
      console.error('❌ Error syncing product from Shopify');
      throw error;
    }
  }
}

// Export singleton instance
export default new ShopifyService();
