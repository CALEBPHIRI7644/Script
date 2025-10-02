const express = require("express");
const app = express();
const mysql2 = require("mysql2");
const session = require("express-session");
const bcrypt = require("bcrypt");

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json());
app.set("view engine", "ejs");

// MySQL connection pool
const pool = mysql2.createPool({
  host: "localhost",
  user: "root",
  database: "shopping",
  password: "",
});

// Express session
app.use(
  session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false,
  })
);

// Middleware to check roles
function requireRole(role) {
  return (req, res, next) => {
    if (req.session.user && req.session.user.role === role) {
      return next();
    }
    return res.status(403).send("Access denied");
  };
}

// ROUTES

// Landing Page - Public route
app.get("/", async (req, res) => {
  try {
    const [latestProducts] = await pool
      .promise()
      .query(
        "SELECT * FROM products WHERE quantity > 0 ORDER BY id DESC LIMIT 4"
      );

    const [allProducts] = await pool
      .promise()
      .query("SELECT * FROM products ORDER BY id DESC");

    res.render("landing_page", {
      latestProducts,
      allProducts,
    });
  } catch (err) {
    console.error("Error loading landing page:", err);
    res.send("Error loading page");
  }
});

// Registration
app.get("/register1", (req, res) => {
  res.render("register1");
});

app.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.send("All fields are required");
  }

  try {
    const [results] = await pool
      .promise()
      .query("SELECT * FROM users WHERE email=?", [email]);
    if (results.length) return res.send("Email already registered");

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool
      .promise()
      .query(
        "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
        [name, email, hashedPassword, role]
      );
    res.redirect("/login");
  } catch (err) {
    console.error("Insert error:", err);
    res.send("Error registering user: " + err.message);
  }
});

// LOGIN
app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const [results] = await pool
      .promise()
      .query("SELECT * FROM users WHERE email=?", [email]);
    if (!results.length) return res.send("User not found");

    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.send("Invalid password");

    req.session.user = user;

    if (user.role === "admin") return res.redirect("/admin/dashboard");
    if (user.role === "seller") return res.redirect("/seller/dashboard");
    if (user.role === "customer") return res.redirect("/customer/dashboard");

    res.send("Role not recognized");
  } catch (err) {
    res.send("DB error");
  }
});

// LOGOUT
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// ADMIN ROUTES

app.get("/admin/dashboard", requireRole("admin"), (req, res) => {
  res.render("admin_dashboard", { user: req.session.user });
});

app.get("/admin/products", requireRole("admin"), (req, res) => {
  pool.query(
    `SELECT p.*, 
            u.email AS seller_email,
            u.name AS seller_name
     FROM products p 
     LEFT JOIN users u ON p.seller_id=u.id`,
    (err, results) => {
      if (err) return res.send("Error fetching products");
      res.render("admin_products", {
        products: results,
        user: req.session.user,
      });
    }
  );
});

app.get("/admin/orders", requireRole("admin"), (req, res) => {
  pool.query("SELECT * FROM orders", (err, results) => {
    if (err) return res.send("Error fetching orders");
    res.render("admin_orders", {
      orders: results,
      user: req.session.user,
    });
  });
});

// Admin Add Product GET
app.get(
  "/admin/products/admin_add_product",
  requireRole("admin"),
  async (req, res) => {
    try {
      const [users] = await pool
        .promise()
        .query("SELECT id, name, email, role FROM users");
      res.render("admin_add_product", {
        users,
        user: req.session.user,
      });
    } catch (err) {
      console.error(err);
      res.send("Error loading users");
    }
  }
);

// Admin Add Product POST
app.post(
  "/admin/products/admin_add_product",
  requireRole("admin"),
  (req, res) => {
    const { name, price, quantity, seller_id, image } = req.body;

    if (!name || !price || !quantity || !seller_id) {
      return res.send("Name, price, quantity, and seller are required");
    }

    pool.query(
      "INSERT INTO products (name, price, quantity, seller_id, image) VALUES (?, ?, ?, ?, ?)",
      [name, price, quantity, seller_id, image || null],
      (err) => {
        if (err) return res.send("Error adding product: " + err.message);
        res.redirect("/admin/products");
      }
    );
  }
);

// SELLER ROUTES

app.get("/seller/dashboard", requireRole("seller"), (req, res) => {
  res.render("seller_dashboard", { user: req.session.user });
});

app.get("/seller/products", requireRole("seller"), (req, res) => {
  pool.query(
    "SELECT * FROM products WHERE seller_id=?",
    [req.session.user.id],
    (err, results) => {
      if (err) return res.send("Error fetching products");
      res.render("seller_products", {
        products: results,
        user: req.session.user,
      });
    }
  );
});

// Seller Add Product GET
app.get("/seller/products/add", requireRole("seller"), (req, res) => {
  res.render("seller_add_product", { user: req.session.user });
});

// Seller Add Product POST
app.post("/seller/products/add", requireRole("seller"), (req, res) => {
  const { name, price, quantity, image } = req.body;
  const seller_id = req.session.user.id;

  if (!name || !price || !quantity) {
    return res.send("Name, price, and quantity are required");
  }

  pool.query(
    "INSERT INTO products (name, price, quantity, seller_id, image) VALUES (?, ?, ?, ?, ?)",
    [name, price, quantity, seller_id, image || null],
    (err) => {
      if (err) return res.send("Error adding product: " + err.message);
      res.redirect("/seller/products");
    }
  );
});

// Seller Orders
app.get("/seller/orders", requireRole("seller"), (req, res) => {
  const sellerId = req.session.user.id;

  pool.query(
    `SELECT o.id AS order_id, o.total, o.status, 
            oi.product_id, oi.quantity, oi.price, p.name
     FROM orders o
     JOIN order_items oi ON o.id = oi.order_id
     JOIN products p ON oi.product_id = p.id
     WHERE p.seller_id = ?`,
    [sellerId],
    (err, results) => {
      if (err) return res.send("Error fetching orders: " + err.message);

      const orders = {};
      results.forEach((row) => {
        if (!orders[row.order_id]) {
          orders[row.order_id] = {
            id: row.order_id,
            total: row.total,
            status: row.status,
            items: [],
          };
        }
        orders[row.order_id].items.push({
          product_id: row.product_id,
          name: row.name,
          quantity: row.quantity,
          price: row.price,
        });
      });

      res.render("seller_orders", {
        orders: Object.values(orders),
        user: req.session.user,
      });
    }
  );
});

// Customer Dashboard - CORRECTED WITH ALL REQUIRED VARIABLES
app.get("/customer/dashboard", requireRole("customer"), async (req, res) => {
  try {
    const customerId = req.session.user.id;

    // Get order statistics
    const [orders] = await pool
      .promise()
      .query("SELECT * FROM orders WHERE customer_id = ?", [customerId]);

    const totalOrders = orders.length;
    const pendingOrders = orders.filter((o) => o.status === "Pending").length;
    const deliveredOrders = orders.filter(
      (o) => o.status === "Delivered"
    ).length;
    const totalSpent = orders.reduce(
      (sum, order) => sum + parseFloat(order.total),
      0
    );

    // Get some featured products
    const [products] = await pool
      .promise()
      .query("SELECT * FROM products WHERE quantity > 0 LIMIT 8");

    // Check for saved cart
    const [savedCart] = await pool
      .promise()
      .query("SELECT * FROM saved_carts WHERE customer_id = ?", [customerId]);

    res.render("customer_dashboard", {
      user: req.session.user,
      totalOrders,
      pendingOrders,
      deliveredOrders,
      totalSpent,
      products,
      hasSavedCart: savedCart.length > 0,
      currentPage: "dashboard",
      // ADDED THESE MISSING VARIABLES:
      searchQuery: "",
      sortBy: "newest",
      minPrice: "",
      maxPrice: "",
    });
  } catch (err) {
    console.error("Error loading dashboard:", err);
    res.send("Error loading dashboard: " + err.message);
  }
});

// Browse Products with Search and Filters
app.get("/customer/browse", requireRole("customer"), async (req, res) => {
  try {
    const searchQuery = req.query.search || "";
    const sortBy = req.query.sort || "newest";
    const minPrice = parseFloat(req.query.min_price) || 0;
    const maxPrice = parseFloat(req.query.max_price) || 999999;

    let query = "SELECT * FROM products WHERE quantity > 0";
    const params = [];

    if (searchQuery) {
      query += " AND name LIKE ?";
      params.push(`%${searchQuery}%`);
    }

    query += " AND price >= ? AND price <= ?";
    params.push(minPrice, maxPrice);

    switch (sortBy) {
      case "price_low":
        query += " ORDER BY price ASC";
        break;
      case "price_high":
        query += " ORDER BY price DESC";
        break;
      case "name":
        query += " ORDER BY name ASC";
        break;
      case "newest":
      default:
        query += " ORDER BY id DESC";
        break;
    }

    const [products] = await pool.promise().query(query, params);

    const [savedCart] = await pool
      .promise()
      .query("SELECT * FROM saved_carts WHERE customer_id = ?", [
        req.session.user.id,
      ]);

    res.render("customer_browse", {
      products,
      searchQuery,
      sortBy,
      minPrice: minPrice || "",
      maxPrice: maxPrice === 999999 ? "" : maxPrice,
      user: req.session.user,
      hasSavedCart: savedCart.length > 0,
      currentPage: "browse",
    });
  } catch (err) {
    console.error("Error browsing products:", err);
    res.send("Error loading products: " + err.message);
  }
});

// Quick search API endpoint (for autocomplete)
app.get("/api/search", requireRole("customer"), async (req, res) => {
  try {
    const query = req.query.q || "";
    if (query.length < 2) {
      return res.json([]);
    }

    const [results] = await pool
      .promise()
      .query(
        "SELECT id, name, price FROM products WHERE name LIKE ? AND quantity > 0 LIMIT 10",
        [`%${query}%`]
      );

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Search failed" });
  }
});

// Customer Cart
app.get("/customer/cart", requireRole("customer"), async (req, res) => {
  const message = req.query.message || null;

  try {
    const [savedCart] = await pool
      .promise()
      .query("SELECT * FROM saved_carts WHERE customer_id = ?", [
        req.session.user.id,
      ]);

    if (!req.session.cart || req.session.cart.length === 0) {
      return res.render("customer_cart", {
        products: [],
        message: message || "Cart is empty",
        user: req.session.user,
        hasSavedCart: savedCart.length > 0,
        currentPage: "cart",
      });
    }

    const ids = req.session.cart.map((item) => item.product_id);
    const [products] = await pool
      .promise()
      .query(`SELECT * FROM products WHERE id IN (${ids.join(",")})`);

    const cartProducts = products.map((prod) => {
      const item = req.session.cart.find((i) => i.product_id === prod.id);
      return { ...prod, quantity_in_cart: item.quantity };
    });

    res.render("customer_cart", {
      products: cartProducts,
      message,
      user: req.session.user,
      hasSavedCart: savedCart.length > 0,
      currentPage: "cart",
    });
  } catch (err) {
    res.send("Error loading cart: " + err.message);
  }
});

// Save current cart to database
app.post("/customer/cart/save", requireRole("customer"), async (req, res) => {
  if (!req.session.cart || req.session.cart.length === 0) {
    return res.redirect("/customer/cart?message=Cart is empty");
  }

  try {
    const customerId = req.session.user.id;
    const cartData = JSON.stringify(req.session.cart);

    const [existing] = await pool
      .promise()
      .query("SELECT * FROM saved_carts WHERE customer_id = ?", [customerId]);

    if (existing.length > 0) {
      await pool
        .promise()
        .query(
          "UPDATE saved_carts SET cart_data = ?, updated_at = NOW() WHERE customer_id = ?",
          [cartData, customerId]
        );
    } else {
      await pool
        .promise()
        .query(
          "INSERT INTO saved_carts (customer_id, cart_data) VALUES (?, ?)",
          [customerId, cartData]
        );
    }

    res.redirect("/customer/cart?message=Cart saved successfully");
  } catch (err) {
    console.error("Error saving cart:", err);
    res.send("Error saving cart: " + err.message);
  }
});

// Load saved cart
app.post("/customer/cart/load", requireRole("customer"), async (req, res) => {
  try {
    const customerId = req.session.user.id;

    const [results] = await pool
      .promise()
      .query("SELECT cart_data FROM saved_carts WHERE customer_id = ?", [
        customerId,
      ]);

    if (results.length === 0) {
      return res.redirect("/customer/cart?message=No saved cart found");
    }

    req.session.cart = JSON.parse(results[0].cart_data);
    res.redirect("/customer/cart?message=Cart loaded successfully");
  } catch (err) {
    console.error("Error loading cart:", err);
    res.send("Error loading cart: " + err.message);
  }
});

// Delete saved cart
app.post(
  "/customer/cart/delete-saved",
  requireRole("customer"),
  async (req, res) => {
    try {
      const customerId = req.session.user.id;

      await pool
        .promise()
        .query("DELETE FROM saved_carts WHERE customer_id = ?", [customerId]);

      res.redirect("/customer/cart?message=Saved cart deleted");
    } catch (err) {
      console.error("Error deleting saved cart:", err);
      res.send("Error deleting saved cart: " + err.message);
    }
  }
);

// Add to Cart
app.post("/customer/cart/add", requireRole("customer"), (req, res) => {
  const { product_id, quantity } = req.body;
  if (!req.session.cart) req.session.cart = [];

  const existsIndex = req.session.cart.findIndex(
    (item) => item.product_id == product_id
  );

  if (existsIndex >= 0) {
    req.session.cart[existsIndex].quantity += parseInt(quantity);
  } else {
    req.session.cart.push({
      product_id: parseInt(product_id),
      quantity: parseInt(quantity),
    });
  }
  res.redirect("/customer/cart");
});

// Remove from Cart
app.post("/customer/cart/remove", requireRole("customer"), (req, res) => {
  const { product_id } = req.body;
  if (!req.session.cart) req.session.cart = [];

  req.session.cart = req.session.cart.filter(
    (item) => item.product_id != product_id
  );

  res.redirect("/customer/cart");
});

// Update Cart Quantity
app.post("/customer/cart/update", requireRole("customer"), (req, res) => {
  const { product_id, quantity } = req.body;
  if (!req.session.cart) req.session.cart = [];

  const itemIndex = req.session.cart.findIndex(
    (item) => item.product_id == product_id
  );
  if (itemIndex >= 0) {
    req.session.cart[itemIndex].quantity = parseInt(quantity);
  }

  res.redirect("/customer/cart");
});

// Checkout
app.post(
  "/customer/cart/checkout",
  requireRole("customer"),
  async (req, res) => {
    if (!req.session.cart || req.session.cart.length === 0) {
      return res.send("Cart is empty");
    }

    const connection = await pool.promise().getConnection();
    try {
      await connection.beginTransaction();

      let totalPrice = 0;
      for (const item of req.session.cart) {
        const [productRows] = await connection.query(
          "SELECT * FROM products WHERE id = ? FOR UPDATE",
          [item.product_id]
        );

        if (!productRows.length || productRows[0].quantity < item.quantity) {
          throw new Error(
            "Insufficient stock for product ID: " + item.product_id
          );
        }

        totalPrice += productRows[0].price * item.quantity;
      }

      const [orderResult] = await connection.query(
        "INSERT INTO orders (customer_id, total, status) VALUES (?, ?, ?)",
        [req.session.user.id, totalPrice, "Pending"]
      );

      for (const item of req.session.cart) {
        const [productRows] = await connection.query(
          "SELECT * FROM products WHERE id = ?",
          [item.product_id]
        );

        await connection.query(
          "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
          [
            orderResult.insertId,
            item.product_id,
            item.quantity,
            productRows[0].price,
          ]
        );

        await connection.query(
          "UPDATE products SET quantity = quantity - ? WHERE id = ?",
          [item.quantity, item.product_id]
        );
      }

      await connection.commit();
      req.session.cart = [];
      res.redirect("/customer/orders?message=Order placed successfully");
    } catch (err) {
      await connection.rollback();
      res.send("Error placing order: " + err.message);
    } finally {
      connection.release();
    }
  }
);

// Customer Orders
app.get("/customer/orders", requireRole("customer"), (req, res) => {
  const customerId = req.session.user.id;
  const message = req.query.message || null;

  pool.query(
    `SELECT o.id AS order_id, o.total, o.status, 
            oi.product_id, oi.quantity, oi.price, p.name AS product_name
     FROM orders o
     JOIN order_items oi ON o.id = oi.order_id
     JOIN products p ON oi.product_id = p.id
     WHERE o.customer_id = ?`,
    [customerId],
    (err, results) => {
      if (err) return res.send("Error fetching orders: " + err.message);

      const orders = {};
      results.forEach((row) => {
        if (!orders[row.order_id]) {
          orders[row.order_id] = {
            id: row.order_id,
            total: row.total,
            status: row.status,
            items: [],
          };
        }
        orders[row.order_id].items.push({
          product_id: row.product_id,
          name: row.product_name,
          quantity: row.quantity,
          price: row.price,
        });
      });

      res.render("customer_orders", {
        orders: Object.values(orders),
        message,
        user: req.session.user,
        currentPage: "orders",
      });
    }
  );
});

// Cancel Order
app.post(
  "/customer/orders/cancel",
  requireRole("customer"),
  async (req, res) => {
    const { order_id } = req.body;
    const connection = await pool.promise().getConnection();

    try {
      await connection.beginTransaction();

      await connection.query("DELETE FROM order_items WHERE order_id = ?", [
        order_id,
      ]);

      await connection.query("DELETE FROM orders WHERE id = ?", [order_id]);

      await connection.commit();
      res.redirect("/customer/orders?message=Order cancelled successfully");
    } catch (err) {
      await connection.rollback();
      res.send("Error cancelling order: " + err.message);
    } finally {
      connection.release();
    }
  }
);

// SERVER
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at: http://localhost:${PORT}`);
});
