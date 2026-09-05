<template>
  <div class="welcome" @keyup.enter="register">
    <div class="auth-art">
      <div class="auth-brand">
        <img loading="lazy" alt="Cheeko" src="@/assets/cheeko-logo.svg" />
        <span class="auth-meta">Operator console</span>
      </div>
      <p class="auth-quote">One account. One family. One shelf of toys.</p>
      <div class="auth-meta">Accounts are approved by a workspace admin</div>
    </div>

    <div class="auth-form">
      <div class="auth-box">
        <h1 class="auth-title">Create account</h1>
        <p class="auth-lead">Parents register here to bind a toy. Operator accounts are provisioned by an admin.</p>

        <form @submit.prevent="register">
          <!-- Username registration -->
          <div class="input-box" v-if="!enableMobileRegister">
            <span class="micro-label">Username</span>
            <el-input v-model="form.username" placeholder="Enter username" />
          </div>

          <!-- Mobile registration -->
          <template v-if="enableMobileRegister">
            <div class="input-box">
              <span class="micro-label">Phone number</span>
              <div style="display: flex; align-items: center; gap: 10px;">
                <el-select v-model="form.areaCode" style="width: 190px;">
                  <el-option v-for="item in mobileAreaList" :key="item.key" :label="`${item.name} (${item.key})`"
                    :value="item.key" />
                </el-select>
                <el-input v-model="form.mobile" placeholder="Enter phone number" />
              </div>
            </div>

            <div class="input-row">
              <div class="input-box">
                <span class="micro-label">Verification code</span>
                <el-input v-model="form.captcha" placeholder="Enter the code" />
              </div>
              <img loading="lazy" v-if="captchaUrl" :src="captchaUrl" alt="Verification code"
                class="captcha-img" @click="fetchCaptcha" />
            </div>

            <div class="input-row">
              <div class="input-box">
                <span class="micro-label">SMS code</span>
                <el-input v-model="form.mobileCaptcha" placeholder="6-digit code" maxlength="6" />
              </div>
              <el-button class="send-captcha-btn" :disabled="!canSendMobileCaptcha" @click="sendMobileCaptcha">
                {{ countdown > 0 ? `Retry in ${countdown}s` : 'Send code' }}
              </el-button>
            </div>
          </template>

          <div class="input-box">
            <span class="micro-label">Password</span>
            <el-input v-model="form.password" placeholder="At least 8 characters" type="password" show-password />
          </div>

          <div class="input-box">
            <span class="micro-label">Confirm password</span>
            <el-input v-model="form.confirmPassword" placeholder="Repeat the password" type="password" show-password />
          </div>

          <!-- Captcha for username registration -->
          <div v-if="!enableMobileRegister" class="input-row">
            <div class="input-box">
              <span class="micro-label">Verification code</span>
              <el-input v-model="form.captcha" placeholder="Enter the code" />
            </div>
            <img loading="lazy" v-if="captchaUrl" :src="captchaUrl" alt="Verification code"
              class="captcha-img" @click="fetchCaptcha" />
          </div>
        </form>

        <div class="login-btn" @click="register">Create account</div>

        <div class="auth-alt">
          Already registered? <span class="link" @click="goToLogin">Sign in</span>
        </div>

        <div class="auth-legal">
          By registering you agree to the
          <span class="link">Terms of Service</span> and <span class="link">Privacy Policy</span>.
        </div>

        <div class="auth-footer">
          <version-footer />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import Api from '@/apis/api';
import VersionFooter from '@/components/VersionFooter.vue';
import { getUUID, goToPage, showDanger, showSuccess, validateMobile } from '@/utils';
import { mapState } from 'vuex';

export default {
  name: 'register',
  components: {
    VersionFooter
  },
  computed: {
    ...mapState({
      allowUserRegister: state => state.pubConfig.allowUserRegister,
      enableMobileRegister: state => state.pubConfig.enableMobileRegister,
      mobileAreaList: state => state.pubConfig.mobileAreaList
    }),
    canSendMobileCaptcha() {
      return this.countdown === 0 && validateMobile(this.form.mobile, this.form.areaCode);
    }
  },
  data() {
    return {
      form: {
        username: '',
        password: '',
        confirmPassword: '',
        captcha: '',
        captchaId: '',
        areaCode: '+86',
        mobile: '',
        mobileCaptcha: ''
      },
      captchaUrl: '',
      countdown: 0,
      timer: null
    }
  },
  mounted() {
    this.$store.dispatch('fetchPubConfig').then(() => {
      if (!this.allowUserRegister) {
        showDanger('User registration is currently not allowed');
        setTimeout(() => {
          goToPage('/login');
        }, 1500);
      }
    });
    this.fetchCaptcha();
  },
  methods: {
    // Reuse captcha fetch method
    fetchCaptcha() {
      this.form.captchaId = getUUID();
      Api.user.getCaptcha(this.form.captchaId, (res) => {
        if (res.status === 200) {
          const blob = new Blob([res.data], { type: res.data.type });
          this.captchaUrl = URL.createObjectURL(blob);

        } else {
          console.error('Captcha loading error:', error);
          showDanger('Failed to load captcha, click to refresh');
        }
      });
    },

    // Encapsulate input validation logic
    validateInput(input, message) {
      if (!input.trim()) {
        showDanger(message);
        return false;
      }
      return true;
    },

    // Send mobile verification code
    sendMobileCaptcha() {
      if (!validateMobile(this.form.mobile, this.form.areaCode)) {
        showDanger('Please enter a valid phone number');
        return;
      }

      // Verify captcha
      if (!this.validateInput(this.form.captcha, 'Please enter the captcha')) {
        this.fetchCaptcha();
        return;
      }

      // Clear any existing timer
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }

      // Start countdown
      this.countdown = 60;
      this.timer = setInterval(() => {
        if (this.countdown > 0) {
          this.countdown--;
        } else {
          clearInterval(this.timer);
          this.timer = null;
        }
      }, 1000);

      // Call send verification code API
      Api.user.sendSmsVerification({
        phone: this.form.areaCode + this.form.mobile,
        captcha: this.form.captcha,
        captchaId: this.form.captchaId
      }, (res) => {
        showSuccess('Verification code sent successfully');
      }, (err) => {
        showDanger(err.data.msg || 'Failed to send verification code');
        this.countdown = 0;
        this.fetchCaptcha();
      });
    },

    // Registration logic
    register() {
      if (this.enableMobileRegister) {
        // Mobile registration validation
        if (!validateMobile(this.form.mobile, this.form.areaCode)) {
          showDanger('Please enter a valid phone number');
          return;
        }
        if (!this.form.mobileCaptcha) {
          showDanger('Please enter the SMS verification code');
          return;
        }
      } else {
        // Username registration validation
        if (!this.validateInput(this.form.username, 'Username cannot be empty')) {
          return;
        }
      }

      // Validate password
      if (!this.validateInput(this.form.password, 'Password cannot be empty')) {
        return;
      }
      if (this.form.password !== this.form.confirmPassword) {
        showDanger('Passwords do not match')
        return
      }
      // Validate captcha
      if (!this.validateInput(this.form.captcha, 'Verification code cannot be empty')) {
        return;
      }

      if (this.enableMobileRegister) {
        this.form.username = this.form.areaCode + this.form.mobile
      }

      Api.user.register(this.form, ({ data }) => {
        showSuccess('Registration successful!')
        goToPage('/login')
      }, (err) => {
        showDanger(err.data.msg || 'Registration failed')
        if (err.data != null && err.data.msg != null && err.data.msg.indexOf('captcha') > -1) {
          this.fetchCaptcha()
        }
      })
    },

    goToLogin() {
      goToPage('/login')
    }
  },
  beforeDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
</script>

<style lang="scss" scoped>
@import './auth.scss';

.send-captcha-btn {
  height: 48px;
  flex: 0 0 auto;
  white-space: nowrap;
}
</style>
