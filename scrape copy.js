const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { tmpdir } = require('os');




//get api data from http://localhost:8000/api/vehicles?opened_url=https://www.cars.com/dealers/87677/valley-honda/inventory/



class FacebookMarketplaceAutomation {
  constructor(config) {
    this.config = {
      cookiePath: path.resolve(__dirname, 'facebook_cookies.json'),
      userDataDir: './user_data',
      ...config
    };
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: ['--start-maximized'],
      userDataDir: this.config.userDataDir
    });
    this.page = (await this.browser.pages())[0];
  }

  async handleLogin() {
    try {
      const cookiesExist = await fs.access(this.config.cookiePath).then(() => true).catch(() => false);
      if (cookiesExist) {
        const cookies = JSON.parse(await fs.readFile(this.config.cookiePath));
        await this.page.setCookie(...cookies);
        await this.page.goto('https://www.facebook.com', { waitUntil: 'networkidle2' });
        
        if (await this.page.$('div[aria-label="Account"]') || await this.page.$('div[role="navigation"]')) {
          await this.page.goto('https://www.facebook.com/marketplace/create/vehicle');
          return true;
        }
      }
      await this.loginManually();
      return true;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  }

  async loginManually() {
    await this.page.goto('https://www.facebook.com/login', { waitUntil: 'networkidle0' });
    console.log('Please log in manually to Facebook.');
    await this.page.waitForNavigation({ waitUntil: 'networkidle0' });
    const cookies = await this.page.cookies();
    await fs.writeFile(this.config.cookiePath, JSON.stringify(cookies, null, 2));
    await this.page.goto('https://www.facebook.com/marketplace/create/vehicle');
  }

  async selectDropdownOption(labelText, optionText) {
    await this.page.waitForSelector(`label[aria-label="${labelText}"]`, { visible: true });
    await this.page.click(`label[aria-label="${labelText}"]`);
    await this.page.waitForSelector('div[role="option"]', { visible: true, timeout: 60000 });
    
    await this.page.evaluate((text) => {
      const option = [...document.querySelectorAll('div[role="option"]')]
        .find(el => el.querySelector('span') && el.querySelector('span').innerText.includes(text));
      if (option) option.click();
    }, optionText);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async setInputValue(labelText, value) {
    const selector = `label[aria-label="${labelText}"] ${labelText === 'Description' ? 'textarea' : 'input'}`;
    await this.page.waitForSelector(selector, { visible: true });
    await this.page.type(selector, value.toString(), { delay: 100 });
  }

  async uploadImages(imageUrls) {
    for (const imageUrl of imageUrls) {
      const fileInput = await this.page.$('input[type="file"][accept="image/*,image/heif,image/heic"]');
      if (!fileInput) continue;

      const existingImages = await this.page.evaluate(() => 
        Array.from(document.querySelectorAll('img[src^="https://scontent."]')).map(img => img.src)
      );

      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const tempFilePath = path.join(tmpdir(), `temp_image_${Date.now()}.jpg`);
      await fs.writeFile(tempFilePath, Buffer.from(response.data));
      await fileInput.uploadFile(tempFilePath);
      await new Promise(resolve => setTimeout(resolve, 5000));
      await fs.unlink(tempFilePath);
    }
  }

  async setLocation(location) {
    await this.setInputValue('Location', location);
    await this.page.waitForSelector('ul[aria-label*="suggested searches"] li:first-child', { visible: true });
    await this.page.click('ul[aria-label*="suggested searches"] li:first-child');
    await this.page.waitForFunction(
      (loc) => document.querySelector('label[aria-label="Location"] input').value.includes(loc),
      { timeout: 5000 },
      location
    );
  }

  async createVehicleListing(listingData) {
    try {
      // Select vehicle type
      await this.selectDropdownOption('Vehicle type', listingData.vehicleType);

      // Upload images
      if (listingData.images) {
        await this.uploadImages(listingData.images);
      }

      // Set dropdown values
      const dropdowns = {
        'Year': listingData.year,
        'Make': listingData.make,
        'Vehicle condition': listingData.condition,
        'Fuel type': listingData.fuelType,
        'Transmission': listingData.transmission,
        'Interior colour': listingData.interiorColor,
        'Exterior colour': listingData.exteriorColor,
        'Body style': listingData.bodyStyle
      };

      for (const [label, value] of Object.entries(dropdowns)) {
        if (value) await this.selectDropdownOption(label, value);
      }

      // Set input values
      const inputs = {
        'Model': listingData.model,
        'Mileage': listingData.mileage,
        'Price': listingData.price,
        'Description': listingData.description
      };

      for (const [label, value] of Object.entries(inputs)) {
        if (value) await this.setInputValue(label, value);
      }

      // Set location
      if (listingData.location) {
        await this.setLocation(listingData.location);
      }

      return true;
    } catch (error) {
      console.error('Error creating listing:', error);
      return false;
    }
  }
}

// Example usage:
const run = async () => {
  const automation = new FacebookMarketplaceAutomation();
  await automation.init();
  await automation.handleLogin();

  const listingData = {
    vehicleType: 'Car/van',
    images: [
      'https://images.pexels.com/photos/170811/pexels-photo-170811.jpeg?auto=compress&cs=tinysrgb&w=600',
      'https://images.pexels.com/photos/919073/pexels-photo-919073.jpeg?auto=compress&cs=tinysrgb&w=600'
    ],
    year: '2020',
    make: 'Ferrari',
    model: 'F8 Tributo',
    mileage: '1000',
    condition: 'Good',
    fuelType: 'Petrol',
    transmission: 'Automatic transmission',
    interiorColor: 'Black',
    exteriorColor: 'Red',
    bodyStyle: 'Other',
    price: '5000',
    description: 'A well-maintained luxury vehicle.',
    location: 'London'
  };

  await automation.createVehicleListing(listingData);
};

run().catch(console.error);