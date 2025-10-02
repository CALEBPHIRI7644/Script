// public/js/auth.js
      const form = document.getElementById("registerForm");
      const name = document.getElementById("name");
      const email = document.getElementById("email");
      const password = document.getElementById("password");
      const confirmPassword = document.getElementById("confirmPassword");

      const nameError = document.getElementById("nameError");
      const emailError = document.getElementById("emailError");
      const passwordError = document.getElementById("passwordError");
      const confirmPasswordError = document.getElementById("confirmPasswordError");

      const togglePassword = document.getElementById("togglePassword");
      const toggleConfirmPassword = document.getElementById("toggleConfirmPassword");

      // Toggle password visibility
      togglePassword.addEventListener("click", function() {
        const type = password.type === "password" ? "text" : "password";
        password.type = type;
        this.textContent = type === "password" ? "👁️" : "🙈";
      });

      toggleConfirmPassword.addEventListener("click", function() {
        const type = confirmPassword.type === "password" ? "text" : "password";
        confirmPassword.type = type;
        this.textContent = type === "password" ? "👁️" : "🙈";
      });

      // Show error with fade-in effect
      function showError(errorElement, inputElement) {
        errorElement.classList.add("show");
        inputElement.classList.add("error-border");
        inputElement.classList.remove("success-border");
      }

      // Hide error with fade-out effect
      function hideError(errorElement, inputElement) {
        errorElement.classList.remove("show");
        inputElement.classList.remove("error-border");
        inputElement.classList.add("success-border");
      }

      // Clear borders when field is empty
      function clearBorder(inputElement) {
        inputElement.classList.remove("error-border", "success-border");
      }

      // Name validation
      function validateName() {
        const value = name.value.trim();
        
        if (value === "") {
          clearBorder(name);
          nameError.classList.remove("show");
          return false;
        }
        
        if (value.length < 2) {
          showError(nameError, name);
          return false;
        } else {
          hideError(nameError, name);
          return true;
        }
      }

      // Email validation
      function validateEmail() {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const value = email.value.trim();
        
        if (value === "") {
          clearBorder(email);
          emailError.classList.remove("show");
          return false;
        }
        
        if (!emailRegex.test(value)) {
          showError(emailError, email);
          return false;
        } else {
          hideError(emailError, email);
          return true;
        }
      }

      // Password validation
      function validatePassword() {
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
        const value = password.value.trim();
        
        if (value === "") {
          clearBorder(password);
          passwordError.classList.remove("show");
          return false;
        }
        
        if (!passwordRegex.test(value)) {
          showError(passwordError, password);
          return false;
        } else {
          hideError(passwordError, password);
          return true;
        }
      }

      // Confirm password validation
      function validateConfirmPassword() {
        const value = confirmPassword.value.trim();
        
        if (value === "") {
          clearBorder(confirmPassword);
          confirmPasswordError.classList.remove("show");
          return false;
        }
        
        if (value !== password.value.trim()) {
          showError(confirmPasswordError, confirmPassword);
          return false;
        } else {
          hideError(confirmPasswordError, confirmPassword);
          return true;
        }
      }

      // Live validation on input
      name.addEventListener("input", validateName);
      name.addEventListener("blur", validateName);

      email.addEventListener("input", validateEmail);
      email.addEventListener("blur", validateEmail);

      password.addEventListener("input", function() {
        validatePassword();
        // Also validate confirm password when password changes
        if (confirmPassword.value.trim() !== "") {
          validateConfirmPassword();
        }
      });
      password.addEventListener("blur", validatePassword);

      confirmPassword.addEventListener("input", validateConfirmPassword);
      confirmPassword.addEventListener("blur", validateConfirmPassword);

      // Form submission
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        
        const isNameValid = validateName();
        const isEmailValid = validateEmail();
        const isPasswordValid = validatePassword();
        const isConfirmPasswordValid = validateConfirmPassword();

        if (isNameValid && isEmailValid && isPasswordValid && isConfirmPasswordValid) {
          // If all validations pass, submit the form
          form.submit();
        }
      });