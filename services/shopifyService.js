import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class ShopifyService {
  constructor() {
    this.shopifyStore = process.env.SHOPIFY_STORE_URL;
    this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    this.apiVersion = process.env.SHOPIFY_API_VERSION || '2024-01';
    
    // Create axios instance with Shopify config
    this.api = axios.create({
      baseURL: `https://${this.shopifyStore}/admin/api/${this.apiVersion}`,
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });
  }

  // Get all locations (warehouses)
  async getLocations() {
    try {
      const response = await this.api.get('/locations.json');
      console.log('✅ Fetched locations from Shopify');
      return response.data.locations;
    } catch (error) {
      console.error('❌ Error fetching locations:', error.response?.data || error.message);
      throw new Error('Failed to fetch Shopify locations');
    }
  }

  // Get product details from Shopify
  async getProduct(productId) {
    try {
      const response = await this.api.get(`/products/${productId}.json`);
      console.log(`✅ Fetched product ${productId} from Shopify`);
      return response.data.product;
    } catch (error) {
      console.error(`❌ Error fetching product ${productId}:`, error.response?.data || error.message);
      throw new Error(`Failed to fetch product ${productId} from Shopify`);
    }
  }

  // Get inventory item details
  async getInventoryItem(inventoryItemId) {
    try {
      const response = await this.api.get(`/inventory_items/${inventoryItemId}.json`);
      console.log(`✅ Fetched inventory item ${inventoryItemId}`);
      return response.data.inventory_item;
    } catch (error) {
      console.error(`❌ Error fetching inventory item:`, error.response?.data || error.message);
      throw new Error('Failed to fetch inventory item');
    }
  }

  // Get current inventory level
  async getInventoryLevel(inventoryItemId, locationId) {
    try {
      const response = await this.api.get('/inventory_levels.json', {
        params: {
          inventory_item_ids: inventoryItemId,
          location_ids: locationId
        }
      });
      
      if (response.data.inventory_levels.length === 0) {
        throw new Error('Inventory level not found');
      }
      
      console.log(`✅ Current stock: ${response.data.inventory_levels[0].available} units`);
      return response.data.inventory_levels[0];
    } catch (error) {
      console.error('❌ Error fetching inventory level:', error.response?.data || error.message);
      throw new Error('Failed to fetch inventory level');
    }
  }

  // Update inventory on Shopify (SET to exact quantity)
  async updateInventory(inventoryItemId, locationId, newQuantity) {
    try {
      const response = await this.api.post('/inventory_levels/set.json', {
        location_id: parseInt(locationId),
        inventory_item_id: parseInt(inventoryItemId),
        available: parseInt(newQuantity)
      });
      
      console.log(`✅ Shopify inventory updated to ${newQuantity} units`);
      return response.data.inventory_level;
    } catch (error) {
      console.error('❌ Error updating Shopify inventory:', error.response?.data || error.message);
      throw new Error('Failed to update Shopify inventory: ' + (error.response?.data?.errors || error.message));
    }
  }

  // Adjust inventory (add or subtract from current)
  async adjustInventory(inventoryItemId, locationId, adjustment) {
    try {
      const response = await this.api.post('/inventory_levels/adjust.json', {
        location_id: parseInt(locationId),
        inventory_item_id: parseInt(inventoryItemId),
        available_adjustment: parseInt(adjustment)
      });
      
      console.log(`✅ Shopify inventory adjusted by ${adjustment}`);
      return response.data.inventory_level;
    } catch (error) {
      console.error('❌ Error adjusting Shopify inventory:', error.response?.data || error.message);
      throw new Error('Failed to adjust Shopify inventory');
    }
  }

  // Sync product from Shopify to your database
  async syncProductFromShopify(productId) {
    try {
      const product = await this.getProduct(productId);
      const variant = product.variants[0]; // Get first variant
      
      return {
        shopify_product_id: product.id,
        shopify_variant_id: variant.id,
        shopify_inventory_item_id: variant.inventory_item_id,
        name: product.title,
        sku: variant.sku,
        price: variant.price,
        stock: variant.inventory_quantity
      };
    } catch (error) {
      console.error('❌ Error syncing product from Shopify:', error.message);
      throw error;
    }
  }
}

export default new ShopifyService();
