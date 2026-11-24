/**
 * Fills the database with demo data: categories, products, an admin and a
 * customer account, live deals at different stages, and two finished deals
 * (one that succeeded, one that failed) so every screen has something to show.
 *
 *   npm run seed
 *
 * WARNING: this wipes the Huddle collections first.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");
const Category = require("./models/Category");
const Product = require("./models/Product");
const Deal = require("./models/Deal");
const Pledge = require("./models/Pledge");
const Order = require("./models/Order");
const Message = require("./models/Message");
const { joinDeal, closeDeal } = require("./lib/dealEngine");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/huddle";
const DAY = 24 * 60 * 60 * 1000;

const PRODUCTS = [
  // [title, code, price, category, brand, description]
  ["Aureliaa Cotton Kurti", "WM-1001", 899, "women", "Aureliaa", "Soft cotton straight-fit kurti with hand-block print. Machine washable."],
  ["Sangria Anarkali Kurti", "WM-1002", 1499, "women", "Sangria", "Flared anarkali kurti with embroidered yoke, ideal for festive days."],
  ["Gangria Denim Kurti", "WM-1003", 1099, "women", "Gangria", "Denim-look kurti with three-quarter sleeves and side slits."],
  ["Mint Floral Midi Dress", "WM-1004", 1799, "women", "Biba Studio", "Light, breathable midi dress with a floral pattern and tie waist."],
  ["High-Rise Linen Trousers", "WM-1005", 1299, "women", "Urban Loom", "Relaxed linen trousers with an elastic back waist and deep pockets."],
  ["Block-Print Palazzo Set", "WM-1006", 1599, "women", "Aureliaa", "Cotton palazzo with matching dupatta, in a bold block print."],
  ["Vinayak Graphic Tee", "MN-2001", 699, "men", "Vinayak", "Heavy-weight cotton tee with a minimalist chest graphic."],
  ["Louis Check Overshirt", "MN-2002", 1899, "men", "Louis & Co", "Brushed cotton check overshirt, works as a light jacket."],
  ["Solid Mandarin-Collar Shirt", "MN-2003", 1199, "men", "Allen Row", "Slim-fit sky blue shirt with a mandarin collar."],
  ["Slim Stretch Chinos", "MN-2004", 1499, "men", "Allen Row", "Four-way stretch chinos that stay crisp all day."],
  ["Festive Kurta Set", "MN-2005", 2199, "men", "Weave & Co", "Straight kurta with churidar in a self-woven jacquard."],
  ["Classic White Sneakers", "MN-2006", 2499, "men", "StepOne", "Everyday leather-look sneakers with cushioned insoles."],
  ["Flower World Romper", "KD-3001", 499, "kids", "Flower World", "Striped cotton romper for babies, with snap buttons."],
  ["CuteKids Printed Kurta", "KD-3002", 999, "kids", "CuteKids", "Festive printed kurta for boys, soft inner lining."],
  ["Little Twirl Frock", "KD-3003", 849, "kids", "Little Twirl", "Cotton frock with a twirly skirt and bow detail."],
  ["Play Day Denim Shorts", "KD-3004", 599, "kids", "Play Day", "Soft washed denim shorts with an adjustable waist."],
];

const PRODUCT_IMAGES = {
  "WM-1001": "/images/products/wm-1001-kurti.jpg",
  "WM-1002": "/images/products/wm-1002-anarkali.jpg",
  "WM-1003": "/images/products/wm-1003-denim-kurti.jpg",
  "WM-1004": "/images/products/wm-1004-midi-dress.jpg",
  "WM-1005": "/images/products/wm-1005-trousers.jpg",
  "WM-1006": "/images/products/wm-1006-palazzo-set.jpg",
  "MN-2001": "/images/products/mn-2001-graphic-tee.jpg",
  "MN-2002": "/images/products/mn-2002-overshirt.jpg",
  "MN-2003": "/images/products/mn-2003-mandarin-shirt.jpg",
  "MN-2004": "/images/products/mn-2004-chinos.jpg",
  "MN-2005": "/images/products/mn-2005-kurta-set.jpg",
  "MN-2006": "/images/products/mn-2006-sneakers.jpg",
  "KD-3001": "/images/products/kd-3001-romper.jpg",
  "KD-3002": "/images/products/kd-3002-printed-kurta.jpg",
  "KD-3003": "/images/products/kd-3003-frock.jpg",
  "KD-3004": "/images/products/kd-3004-denim-shorts.jpg",
};

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected. Clearing old demo data...");
  await Promise.all([User, Category, Product, Deal, Pledge, Order, Message].map((m) => m.deleteMany({})));

  // users
  const admin = new User({ username: "Huddle Admin", email: "admin@huddle.test", role: "admin" });
  admin.password = admin.encryptPassword("Admin@12345");
  await admin.save();
  const customer = new User({ username: "Demo Customer", email: "customer@huddle.test" });
  customer.password = customer.encryptPassword("Shop@12345");
  await customer.save();

  // categories
  const cats = {};
  for (const [slug, title] of [["men", "Men"], ["women", "Women"], ["kids", "Kids"]]) {
    cats[slug] = await Category.create({ title, slug });
  }

  // products - staggered creation dates so "Latest Products" has a real order
  const products = [];
  for (let i = 0; i < PRODUCTS.length; i++) {
    const [title, productCode, price, cat, manufacturer, description] = PRODUCTS[i];
    products.push(
      await Product.create({
        title,
        productCode,
        imagePath: PRODUCT_IMAGES[productCode],
        price,
        manufacturer,
        description,
        category: cats[cat]._id,
        available: true,
        createdAt: new Date(Date.now() - (PRODUCTS.length - i) * DAY),
      })
    );
  }
  const byCode = Object.fromEntries(products.map((p) => [p.productCode, p]));

  const tiers = [
    { minParticipants: 5, discountPercent: 10 },
    { minParticipants: 15, discountPercent: 25 },
    { minParticipants: 30, discountPercent: 40 },
  ];

  // Shoppers used to fill deals.
  const shoppers = [];
  for (let i = 1; i <= 12; i++) {
    const u = new User({ username: `Demo Shopper ${i}`, email: `demo${i}@huddle.test` });
    u.password = u.encryptPassword("Demo@12345");
    await u.save();
    shoppers.push(u);
  }
  const fill = async (deal, n) => {
    for (let i = 0; i < n; i++) {
      await joinDeal(deal._id, shoppers[i]._id, {
        qty: 1,
        address: "12 Demo Street, New Delhi 110001",
        cardNumber: "4242424242424242",
      });
    }
  };

  // Live deals at three stages: goal reached, in progress, brand new.
  const live1 = await Deal.create({ product: byCode["WM-1002"]._id, tiers, endsAt: new Date(Date.now() + 3 * DAY) });
  const live2 = await Deal.create({ product: byCode["MN-2002"]._id, tiers, endsAt: new Date(Date.now() + 2 * DAY + 5 * 3600e3) });
  await Deal.create({ product: byCode["MN-2006"]._id, tiers: [{ minParticipants: 3, discountPercent: 15 }, { minParticipants: 10, discountPercent: 30 }], endsAt: new Date(Date.now() + 5 * DAY), maxParticipants: 50 });
  await fill(live1, 7);
  await fill(live2, 2);

  // Finished deals for history: one success, one that fell short.
  const won = await Deal.create({ product: byCode["KD-3002"]._id, tiers, endsAt: new Date(Date.now() + DAY) });
  await fill(won, 6);
  await closeDeal(won._id);
  await Deal.updateOne({ _id: won._id }, { endsAt: new Date(Date.now() - 2 * DAY) });

  const lost = await Deal.create({ product: byCode["WM-1004"]._id, tiers, endsAt: new Date(Date.now() + DAY) });
  await fill(lost, 2);
  await closeDeal(lost._id);
  await Deal.updateOne({ _id: lost._id }, { endsAt: new Date(Date.now() - 1 * DAY) });

  console.log("\nSeeded!");
  console.log("  Admin:    admin@huddle.test     / Admin@12345");
  console.log("  Customer: customer@huddle.test  / Shop@12345");
  console.log("  Demo shoppers: demo1..demo12@huddle.test / Demo@12345");
  console.log("\nTest card: 4242 4242 4242 4242 (any future expiry, any CVC)");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
