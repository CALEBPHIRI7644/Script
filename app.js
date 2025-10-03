const express = require("express");
const app = express();
const mysql2 = require("mysql2");
const session = require("express-session");
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json());
app.set("view engine", "ejs");

// MySQL connection pool
// const pool = mysql2.createPool({
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   database: process.env.DB_NAME,
//   password: process.env.DB_PASS,
// });
const mysql = require("mysql2");

const pool = mysql
  .createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  })
  .promise();

// const pool = mysql2.createPool({
//   host: "localhost",
//   user: "root",
//   database: "shopping",
//   password: "abcabc12345Abdul",
// });

// Express session
app.use(
  session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false,
  })
);

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "public/uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Only image files are allowed!"));
  },
});

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

// Landing Page
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
app.get("/admin/dashboard", requireRole("admin"), async (req, res) => {
  try {
    const [salesResult] = await pool
      .promise()
      .query("SELECT COALESCE(SUM(total), 0) AS totalSales FROM orders");

    const [ordersResult] = await pool
      .promise()
      .query("SELECT COUNT(*) AS totalOrders FROM orders");

    const [pendingResult] = await pool
      .promise()
      .query(
        "SELECT COUNT(*) AS pendingOrders FROM orders WHERE status = 'Pending'"
      );

    const [deliveredResult] = await pool
      .promise()
      .query(
        "SELECT COUNT(*) AS deliveredOrders FROM orders WHERE status = 'Delivered'"
      );

    const [productsResult] = await pool
      .promise()
      .query("SELECT COUNT(*) AS totalProducts FROM products");

    const [customersResult] = await pool
      .promise()
      .query(
        "SELECT COUNT(*) AS totalCustomers FROM users WHERE role = 'customer'"
      );

    const [sellersResult] = await pool
      .promise()
      .query(
        "SELECT COUNT(*) AS totalSellers FROM users WHERE role = 'seller'"
      );

    const [recentOrders] = await pool.promise().query(`
      SELECT o.id, o.total, o.status,
             COALESCE(u.name, 'Guest') AS customer
      FROM orders o
      LEFT JOIN users u ON o.customer_id = u.id
      ORDER BY o.id DESC
      LIMIT 10
    `);

    // Calculate sales by month for the last 12 months
    const [monthlySales] = await pool.promise().query(`
        SELECT 
          DATE_FORMAT(created_at, '%b') as month,
          YEAR(created_at) as year,
          MONTH(created_at) as month_num,
          COALESCE(SUM(total), 0) as total
        FROM orders
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
        GROUP BY YEAR(created_at), MONTH(created_at), DATE_FORMAT(created_at, '%b')
        ORDER BY YEAR(created_at), MONTH(created_at)
      `);

    // Calculate customer growth by month for the last 12 months
    const [monthlyCustomers] = await pool.promise().query(`
        SELECT 
          DATE_FORMAT(created_at, '%b') as month,
          YEAR(created_at) as year,
          MONTH(created_at) as month_num,
          COUNT(*) as count
        FROM users
        WHERE role = 'customer' AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
        GROUP BY YEAR(created_at), MONTH(created_at), DATE_FORMAT(created_at, '%b')
        ORDER BY YEAR(created_at), MONTH(created_at)
      `);

    // Prepare chart data for last 12 months
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const currentMonth = new Date().getMonth();

    const last12Months = [];
    for (let i = 0; i < 12; i++) {
      const monthIndex = (currentMonth - 11 + i + 12) % 12;
      last12Months.push(months[monthIndex]);
    }

    const salesSeries = last12Months.map((month) => {
      const data = monthlySales.find((m) => m.month === month);
      return data ? parseFloat(data.total) : 0;
    });

    const customerSeries = last12Months.map((month) => {
      const data = monthlyCustomers.find((m) => m.month === month);
      return data ? parseInt(data.count) : 0;
    });

    const charts = {
      labels: last12Months,
      salesSeries: salesSeries,
      customerSeries: customerSeries,
    };

    const cards = {
      totalSales: salesResult[0].totalSales || 0,
      totalOrders: ordersResult[0].totalOrders || 0,
      pendingOrders: pendingResult[0].pendingOrders || 0,
      deliveredOrders: deliveredResult[0].deliveredOrders || 0,
      totalProducts: productsResult[0].totalProducts || 0,
      totalCustomers: customersResult[0].totalCustomers || 0,
      totalSellers: sellersResult[0].totalSellers || 0,
    };

    res.render("admin_dashboard", {
      user: req.session.user,
      cards: cards,
      recentOrders: recentOrders,
      charts: charts,
    });
  } catch (err) {
    console.error("Error loading admin dashboard:", err);
    res.send("Error loading dashboard: " + err.message);
  }
});

app.get("/admin/products", requireRole("admin"), (req, res) => {
  pool.query(
    `SELECT p.*, 
            u.email AS seller_email,
            u.name AS seller_name
     FROM products p 
     LEFT JOIN users u ON p.seller_id=u.id`,
    (err, results) => {
      if (err) {
        console.error("Error fetching products:", err);
        return res.send("Error fetching products: " + err.message);
      }
      res.render("admin_products", {
        products: results,
        user: req.session.user,
      });
    }
  );
});

// Admin Edit Product
app.post(
  "/admin/products/edit/:id",
  requireRole("admin"),
  upload.single("image"),
  async (req, res) => {
    try {
      const productId = req.params.id;
      const { name, price, quantity, imageUrl } = req.body;

      let imagePath;

      const [currentProduct] = await pool
        .promise()
        .query("SELECT image FROM products WHERE id = ?", [productId]);

      const imageType = req.body.imageType || "upload";

      if (imageType === "url" && imageUrl && imageUrl.trim() !== "") {
        if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
          imagePath = imageUrl.split("/").pop();
        } else {
          imagePath = imageUrl;
        }
      } else if (req.file) {
        imagePath = req.file.filename;

        if (currentProduct[0] && currentProduct[0].image) {
          const oldImagePath = path.join(
            __dirname,
            "public/uploads",
            currentProduct[0].image
          );
          if (fs.existsSync(oldImagePath)) {
            try {
              fs.unlinkSync(oldImagePath);
            } catch (err) {
              console.error("Error deleting old image:", err);
            }
          }
        }
      } else {
        imagePath = currentProduct[0].image;
      }

      await pool
        .promise()
        .query(
          "UPDATE products SET name = ?, price = ?, quantity = ?, image = ? WHERE id = ?",
          [name, price, quantity, imagePath, productId]
        );

      res.json({ success: true, message: "Product updated successfully" });
    } catch (error) {
      console.error("Error updating product:", error);
      res
        .status(500)
        .json({ error: "Failed to update product: " + error.message });
    }
  }
);

// Admin Delete Product
app.post(
  "/admin/products/delete/:id",
  requireRole("admin"),
  async (req, res) => {
    try {
      const productId = req.params.id;

      const [product] = await pool
        .promise()
        .query("SELECT image FROM products WHERE id = ?", [productId]);

      if (product.length === 0) {
        return res.status(404).json({ error: "Product not found" });
      }

      await pool
        .promise()
        .query("DELETE FROM products WHERE id = ?", [productId]);

      if (product[0].image) {
        const imagePath = path.join(
          __dirname,
          "public/uploads",
          product[0].image
        );
        if (fs.existsSync(imagePath)) {
          try {
            fs.unlinkSync(imagePath);
          } catch (err) {
            console.error("Error deleting image file:", err);
          }
        }
      }

      res.json({ success: true, message: "Product deleted successfully" });
    } catch (error) {
      console.error("Error deleting product:", error);
      res
        .status(500)
        .json({ error: "Failed to delete product: " + error.message });
    }
  }
);

// Admin View Orders
app.get("/admin/orders", requireRole("admin"), (req, res) => {
  pool.query("SELECT * FROM orders", (err, results) => {
    if (err) return res.send("Error fetching orders");
    res.render("admin_orders", {
      orders: results,
      user: req.session.user,
    });
  });
});

// Admin Update Order Status
app.post("/admin/orders/update/:id", requireRole("admin"), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: "Status is required" });
    }

    const validStatuses = ["Pending", "Shipped", "Delivered"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    await pool
      .promise()
      .query("UPDATE orders SET status = ? WHERE id = ?", [status, orderId]);

    res.json({ success: true, message: "Order status updated successfully" });
  } catch (err) {
    console.error("Error updating order:", err);
    res.status(500).json({ error: "Failed to update order: " + err.message });
  }
});

// Admin Delete Order
app.post("/admin/orders/delete/:id", requireRole("admin"), async (req, res) => {
  try {
    const orderId = req.params.id;
    const connection = await pool.promise().getConnection();

    try {
      await connection.beginTransaction();
      await connection.query("DELETE FROM order_items WHERE order_id = ?", [
        orderId,
      ]);
      await connection.query("DELETE FROM orders WHERE id = ?", [orderId]);
      await connection.commit();
      res.json({ success: true, message: "Order deleted successfully" });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error deleting order:", err);
    res.status(500).json({ error: "Failed to delete order: " + err.message });
  }
});

// Admin Manage Users
app.get("/admin/users", requireRole("admin"), async (req, res) => {
  try {
    const [users] = await pool
      .promise()
      .query("SELECT id, name, email, role FROM users ORDER BY id DESC");

    const [customerCount] = await pool
      .promise()
      .query("SELECT COUNT(*) AS count FROM users WHERE role = 'customer'");

    const [sellerCount] = await pool
      .promise()
      .query("SELECT COUNT(*) AS count FROM users WHERE role = 'seller'");

    const [adminCount] = await pool
      .promise()
      .query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");

    res.render("admin_manage_user", {
      user: req.session.user,
      users: users,
      totalCustomers: customerCount[0].count,
      totalSellers: sellerCount[0].count,
      totalAdmins: adminCount[0].count,
    });
  } catch (err) {
    console.error("Error loading manage users:", err);
    res.send("Error loading page: " + err.message);
  }
});

app.post("/admin/users/add", requireRole("admin"), async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.redirect("/admin/users?error=All fields are required");
  }

  try {
    const [existing] = await pool
      .promise()
      .query("SELECT * FROM users WHERE email = ?", [email]);

    if (existing.length > 0) {
      return res.redirect("/admin/users?error=Email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool
      .promise()
      .query(
        "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
        [name, email, hashedPassword, role]
      );

    res.redirect("/admin/users?success=User added successfully");
  } catch (err) {
    console.error("Error adding user:", err);
    res.redirect("/admin/users?error=" + err.message);
  }
});

// Admin Edit User
app.post("/admin/users/edit", requireRole("admin"), async (req, res) => {
  const { user_id, name, email, role, password } = req.body;

  if (!user_id || !name || !email || !role) {
    return res.redirect(
      "/admin/users?error=All fields except password are required"
    );
  }

  try {
    const [existing] = await pool
      .promise()
      .query("SELECT * FROM users WHERE email = ? AND id != ?", [
        email,
        user_id,
      ]);

    if (existing.length > 0) {
      return res.redirect("/admin/users?error=Email already exists");
    }

    if (password && password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool
        .promise()
        .query(
          "UPDATE users SET name = ?, email = ?, role = ?, password = ? WHERE id = ?",
          [name, email, role, hashedPassword, user_id]
        );
    } else {
      await pool
        .promise()
        .query("UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?", [
          name,
          email,
          role,
          user_id,
        ]);
    }

    res.redirect("/admin/users?success=User updated successfully");
  } catch (err) {
    console.error("Error updating user:", err);
    res.redirect("/admin/users?error=" + err.message);
  }
});

// Admin Delete User
app.post("/admin/users/delete", requireRole("admin"), async (req, res) => {
  const { user_id } = req.body;

  try {
    await pool.promise().query("DELETE FROM users WHERE id = ?", [user_id]);
    res.redirect("/admin/users?success=User deleted successfully");
  } catch (err) {
    console.error("Error deleting user:", err);
    res.redirect("/admin/users?error=" + err.message);
  }
});

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

// Admin Add Product
app.post(
  "/admin/products/admin_add_product",
  requireRole("admin"),
  upload.single("image"),
  (req, res) => {
    const { name, price, quantity, seller_id, imageUrl } = req.body;

    if (!name || !price || !quantity || !seller_id) {
      return res.send("Name, price, quantity, and seller are required");
    }

    let imagePath = null;

    if (req.file) {
      imagePath = req.file.filename;
    } else if (imageUrl && imageUrl.trim() !== "") {
      imagePath = imageUrl.split("/").pop();
    }

    pool.query(
      "INSERT INTO products (name, price, quantity, seller_id, image) VALUES (?, ?, ?, ?, ?)",
      [name, price, quantity, seller_id, imagePath],
      (err) => {
        if (err) return res.send("Error adding product: " + err.message);
        res.redirect("/admin/products");
      }
    );
  }
);

// SELLER ROUTES

// Seller Dashboard - Enhanced
app.get("/seller/dashboard", requireRole("seller"), async (req, res) => {
  try {
    const sellerId = req.session.user.id;

    const [products] = await pool
      .promise()
      .query("SELECT * FROM products WHERE seller_id = ?", [sellerId]);

    const [salesResult] = await pool.promise().query(
      `
        SELECT COALESCE(SUM(oi.quantity * oi.price), 0) AS totalSales
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE p.seller_id = ?
      `,
      [sellerId]
    );

    const [ordersResult] = await pool.promise().query(
      `
        SELECT COUNT(DISTINCT o.id) AS totalOrders
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN products p ON oi.product_id = p.id
        WHERE p.seller_id = ?
      `,
      [sellerId]
    );

    const [pendingResult] = await pool.promise().query(
      `
        SELECT COUNT(DISTINCT o.id) AS pendingOrders
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN products p ON oi.product_id = p.id
        WHERE p.seller_id = ? AND o.status = 'Pending'
      `,
      [sellerId]
    );

    const [deliveredResult] = await pool.promise().query(
      `
        SELECT COUNT(DISTINCT o.id) AS deliveredOrders
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN products p ON oi.product_id = p.id
        WHERE p.seller_id = ? AND o.status = 'Delivered'
      `,
      [sellerId]
    );

    const [recentOrders] = await pool.promise().query(
      `
        SELECT o.id AS order_id, o.status, o.customer_id,
               u.name AS customer_name,
               oi.quantity, oi.price,
               p.name AS product_name,
               (oi.quantity * oi.price) AS item_total
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN products p ON oi.product_id = p.id
        LEFT JOIN users u ON o.customer_id = u.id
        WHERE p.seller_id = ?
        ORDER BY o.id DESC
        LIMIT 10
      `,
      [sellerId]
    );

    const [topProducts] = await pool.promise().query(
      `
        SELECT p.name, COALESCE(SUM(oi.quantity), 0) AS total_sold
        FROM products p
        LEFT JOIN order_items oi ON p.id = oi.product_id
        WHERE p.seller_id = ?
        GROUP BY p.id, p.name
        ORDER BY total_sold DESC
        LIMIT 5
      `,
      [sellerId]
    );

    const totalProducts = products.length;
    const lowStockProducts = products.filter((p) => p.quantity < 5).length;
    const inStockProducts = products.filter((p) => p.quantity > 0).length;
    const totalOrders = ordersResult[0].totalOrders || 0;
    const avgOrderValue =
      totalOrders > 0 ? salesResult[0].totalSales / totalOrders : 0;

    const [itemsSoldResult] = await pool.promise().query(
      `
        SELECT COALESCE(SUM(oi.quantity), 0) AS totalItemsSold
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE p.seller_id = ?
      `,
      [sellerId]
    );

    const [monthlySales] = await pool.promise().query(
      `
        SELECT 
          DATE_FORMAT(o.created_at, '%b') as month,
          COALESCE(SUM(oi.quantity * oi.price), 0) as total
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN products p ON oi.product_id = p.id
        WHERE p.seller_id = ? AND o.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
        GROUP BY YEAR(o.created_at), MONTH(o.created_at), DATE_FORMAT(o.created_at, '%b')
        ORDER BY YEAR(o.created_at), MONTH(o.created_at)
      `,
      [sellerId]
    );

    const [monthlyOrders] = await pool.promise().query(
      `
        SELECT 
          DATE_FORMAT(o.created_at, '%b') as month,
          COUNT(DISTINCT o.id) as count
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN products p ON oi.product_id = p.id
        WHERE p.seller_id = ? AND o.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
        GROUP BY YEAR(o.created_at), MONTH(o.created_at), DATE_FORMAT(o.created_at, '%b')
        ORDER BY YEAR(o.created_at), MONTH(o.created_at)
      `,
      [sellerId]
    );

    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const currentMonth = new Date().getMonth();

    const last12Months = [];
    for (let i = 0; i < 12; i++) {
      const monthIndex = (currentMonth - 11 + i + 12) % 12;
      last12Months.push(months[monthIndex]);
    }

    const salesSeries = last12Months.map((month) => {
      const data = monthlySales.find((m) => m.month === month);
      return data ? parseFloat(data.total) : 0;
    });

    const ordersSeries = last12Months.map((month) => {
      const data = monthlyOrders.find((m) => m.month === month);
      return data ? parseInt(data.count) : 0;
    });

    const charts = {
      labels: last12Months,
      salesSeries: salesSeries,
      ordersSeries: ordersSeries,
    };

    const cards = {
      totalSales: salesResult[0].totalSales || 0,
      totalProducts: totalProducts,
      totalOrders: totalOrders,
      pendingOrders: pendingResult[0].pendingOrders || 0,
      deliveredOrders: deliveredResult[0].deliveredOrders || 0,
      lowStockProducts: lowStockProducts,
      inStockProducts: inStockProducts,
      avgOrderValue: avgOrderValue,
      totalItemsSold: itemsSoldResult[0].totalItemsSold || 0,
    };

    res.render("seller_dashboard", {
      user: req.session.user,
      cards: cards,
      recentOrders: recentOrders,
      topProducts: topProducts,
      charts: charts,
    });
  } catch (err) {
    console.error("Error loading seller dashboard:", err);
    res.send("Error loading dashboard: " + err.message);
  }
});

// Seller Products
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
app.post(
  "/seller/products/add",
  requireRole("seller"),
  upload.single("image"),
  (req, res) => {
    const { name, price, quantity, imageUrl } = req.body;
    const seller_id = req.session.user.id;

    if (!name || !price || !quantity) {
      return res.send("Name, price, and quantity are required");
    }

    let imagePath = null;
    const imageType = req.body.imageType || "upload";

    if (imageType === "url" && imageUrl && imageUrl.trim() !== "") {
      if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
        imagePath = imageUrl.split("/").pop();
      } else {
        imagePath = imageUrl;
      }
    } else if (req.file) {
      imagePath = req.file.filename;
    }

    pool.query(
      "INSERT INTO products (name, price, quantity, seller_id, image) VALUES (?, ?, ?, ?, ?)",
      [name, price, quantity, seller_id, imagePath],
      (err) => {
        if (err) return res.send("Error adding product: " + err.message);
        res.redirect("/seller/products");
      }
    );
  }
);

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

// Seller Update Order Status
app.post("/seller/orders/update", requireRole("seller"), async (req, res) => {
  try {
    const { order_id, status } = req.body;

    const [verification] = await pool.promise().query(
      `
      SELECT DISTINCT o.id 
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.id = ? AND p.seller_id = ?
    `,
      [order_id, req.session.user.id]
    );

    if (verification.length === 0) {
      return res.send("Unauthorized");
    }

    await pool
      .promise()
      .query("UPDATE orders SET status = ? WHERE id = ?", [status, order_id]);

    res.redirect("/seller/orders");
  } catch (err) {
    console.error("Error updating order:", err);
    res.send("Error updating order: " + err.message);
  }
});

// CUSTOMER ROUTES

// Customer Dashboard
app.get("/customer/dashboard", requireRole("customer"), async (req, res) => {
  try {
    const customerId = req.session.user.id;

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

    const [products] = await pool
      .promise()
      .query("SELECT * FROM products WHERE quantity > 0 LIMIT 8");

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

    let query =
      "SELECT id, name, price, quantity, image, seller_id FROM products WHERE quantity > 0";
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

// Quick search API endpoint
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

app.post("/customer/cart/remove", requireRole("customer"), (req, res) => {
  const { product_id } = req.body;
  if (!req.session.cart) req.session.cart = [];

  req.session.cart = req.session.cart.filter(
    (item) => item.product_id != product_id
  );

  res.redirect("/customer/cart");
});

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
