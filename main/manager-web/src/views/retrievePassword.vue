<template>
  <div class="welcome" @keyup.enter="retrievePassword">
    <div class="auth-art">
      <div class="auth-brand">
        <img loading="lazy" alt="Cheeko" src="@/assets/cheeko-logo.svg" />
        <span class="auth-meta">Account recovery</span>
      </div>
      <p class="auth-quote">Back in, in two steps.</p>
      <div class="auth-meta">Codes expire after 10 minutes</div>
    </div>

    <div class="auth-form">
      <div class="auth-box">
        <h1 class="auth-title">Reset password</h1>
        <p class="auth-lead">We will send a one-time code to the mobile number on the account.</p>

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

        <div class="input-box">
          <span class="micro-label">New password</span>
          <el-input v-model="form.newPassword" placeholder="At least 8 characters" type="password" show-password />
        </div>

        <div class="input-box">
          <span class="micro-label">Confirm password</span>
          <el-input v-model="form.confirmPassword" placeholder="Repeat the password" type="password" show-password />
        </div>

        <div class="login-btn" @click="retrievePassword">Reset password</div>

        <div class="auth-alt">
          Remembered it? <span class="link" @click="goToLogin">Back to sign in</span>
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
  name: 'retrieve',
  components: {
    VersionFooter
  },
  computed: {
    ...mapState({
      allowUserRegister: state => state.pubConfig.allowUserRegister,
      mobileAreaList: state => state.pubConfig.mobileAreaList
    }),
    canSendMobileCaptcha() {
      return this.countdown === 0 && validateMobile(this.form.mobile, this.form.areaCode);
    }
  },
  data() {
    return {
      form: {
        areaCode: '+86',
        mobile: '',
        captcha: '',
        captchaId: '',
        smsCode: '',
        newPassword: '',
        confirmPassword: ''
      },
      captchaUrl: '',
      countdown: 0,
      timer: null
    }
  },
  mounted() {
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

      // Validate captcha
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

    // Password reset logic
    retrievePassword() {
      // Validation logic
      if (!validateMobile(this.form.mobile, this.form.areaCode)) {
        showDanger('Please enter a valid phone number');
        return;
      }
      if (!this.form.captcha) {
        showDanger('Please enter the captcha');
        return;
      }
      if (!this.form.mobileCaptcha) {
        showDanger('Please enter the SMS verification code');
        return;
      }
      if (this.form.newPassword !== this.form.confirmPassword) {
        showDanger('Passwords do not match');
        return;
      }

      Api.user.retrievePassword({
        phone: this.form.areaCode + this.form.mobile,
        password: this.form.newPassword,
        code: this.form.mobileCaptcha
      }, (res) => {
        showSuccess('Password reset successful');
        goToPage('/login');
      }, (err) => {
        showDanger(err.data.msg || 'Reset failed');
        if (err.data != null && err.data.msg != null && err.data.msg.indexOf('captcha') > -1) {
          this.fetchCaptcha()
        }
      });
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
