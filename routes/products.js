const router = require("express").Router();
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Deal = require("../models/Deal");
const { escapeRegex } = require("../lib/helpers");

const PER_PAGE = 8;
const SORTS = {
  newest: "-createdAt",
  price_asc: "price",
  price_desc: "-price",
};

// Catalogue + category filter + site search (Experiments 3, 5 and 9)
router.get(["/", "/search"], async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const search = String(req.query.search || "").trim().slice(0, 60);
    const categorySlug = String(req.query.category || "").toLowerCase();
    const sort = SORTS[req.query.sort] ? req.query.sort : "newest";

    const filter = {};
    let category = null;
    if (categorySlug && categorySlug !== "all") {
      category = await Category.findOne({ slug: categorySlug });
      filter.category = category ? category._id : null;
    }
    if (search) {
      // The user's text is escaped so it is matched literally, never as a regex.
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ title: rx }, { productCode: rx }, { manufacturer: rx }, { description: rx }];
    }

    const [count, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .sort(SORTS[sort])
        .skip(PER_PAGE * (page - 1))
        .limit(PER_PAGE)
        .populate("category"),
    ]);

    // Which of these products have a live group deal right now?
    const open = await Deal.find({
      status: "open",
      endsAt: { $gt: new Date() },
      product: { $in: products.map((p) => p._id) },
    });
    const dealByProduct = {};
    open.forEach((d) => {
      dealByProduct[String(d.product)] = d;
    });

    const qs = new URLSearchParams();
    if (search) qs.set("search", search);
    if (categorySlug) qs.set("category", categorySlug);
    if (sort !== "newest") qs.set("sort", sort);

    res.render("shop/index", {
      pageName: search ? `Results for "${search}"` : category ? category.title : "All Products",
      products,
      dealByProduct,
      page,
      pages: Math.max(1, Math.ceil(count / PER_PAGE)),
      count,
      search,
      categorySlug,
      sort,
      baseQuery: qs.toString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return next();
    const product = await Product.findById(req.params.id).populate("category");
    if (!product) return next();

    const [deal, related] = await Promise.all([
      Deal.findOne({ product: product._id, status: "open", endsAt: { $gt: new Date() } }),
      Product.find({ category: product.category._id, _id: { $ne: product._id } })
        .sort("-createdAt")
        .limit(4),
    ]);
    res.render("shop/product", {
      pageName: product.title,
      product,
      deal,
      snap: deal ? deal.snapshot(product.price) : null,
      related,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
