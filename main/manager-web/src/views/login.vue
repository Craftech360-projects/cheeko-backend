<template>
  <div class="welcome">
    <div class="auth-art">
      <div class="auth-brand">
        <img loading="lazy" alt="Cheeko" src="@/assets/cheeko-logo.svg" />
        <span class="auth-meta">Operator console</span>
      </div>
      <p class="auth-quote">Every toy on the shelf, accounted for.</p>
      <div class="auth-meta">Fleet · Families · Content</div>
    </div>

    <div class="auth-form">
      <div class="auth-box" @keyup.enter="login">
        <h1 class="auth-title">Sign in</h1>
        <p class="auth-lead">Access to the Cheeko fleet, family and content console.</p>

        <!-- Username login -->
        <template v-if="!isMobileLogin">
          <div class="input-box">
            <span class="micro-label">Username</span>
            <el-input v-model="form.username" placeholder="Enter username" />
          </div>
        </template>

        <!-- Mobile login -->
        <template v-else>
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
        </template>

        <div class="input-box">
          <span class="micro-label">Password</span>
          <el-input v-model="form.password" placeholder="Enter password" type="password" show-password />
        </div>

        <div class="input-row">
          <div class="input-box">
            <span class="micro-label">Verification code</span>
            <el-input v-model="form.captcha" placeholder="Enter the code" />
          </div>
          <img loading="lazy" v-if="captchaUrl" :src="captchaUrl" alt="Verification code"
            class="captcha-img" @click="fetchCaptcha" />
        </div>

        <div class="login-btn" @click="login">Sign in</div>

        <div class="auth-alt">
          <span v-if="allowUserRegister" class="link" @click="goToRegister">Create an account</span>
          <span v-if="allowUserRegister && enableMobileRegister">·</span>
          <span v-if="enableMobileRegister" class="link" @click="goToForgetPassword">Forgot password?</span>
        </div>

        <!-- Login type switch -->
        <div class="login-type-container" v-if="enableMobileRegister">
          <el-tooltip content="Phone number login" placement="bottom">
            <el-button :type="isMobileLogin ? 'primary' : 'default'" icon="el-icon-mobile" circle
              @click="switchLoginType('mobile')"></el-button>
          </el-tooltip>
          <el-tooltip content="Username login" placement="bottom">
            <el-button :type="!isMobileLogin ? 'primary' : 'default'" icon="el-icon-user" circle
              @click="switchLoginType('username')"></el-button>
          </el-tooltip>
        </div>

        <div class="auth-legal">
          By signing in you agree to the
          <span class="link">User Agreement</span> and <span class="link">Privacy Policy</span>.
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
  name: 'login',
  components: {
    VersionFooter
  },
  computed: {
    ...mapState({
      allowUserRegister: state => state.pubConfig.allowUserRegister,
      enableMobileRegister: state => state.pubConfig.enableMobileRegister,
      mobileAreaList: state => state.pubConfig.mobileAreaList
    })
  },
  data() {
    return {
      activeName: "username",
      form: {
        username: '',
        password: '',
        captcha: '',
        captchaId: '',
        areaCode: '+86',
        mobile: ''
      },
      captchaUuid: '',
      captchaUrl: '',
      isMobileLogin: false
    }
  },
  mounted() {
    this.fetchCaptcha();
    this.$store.dispatch('fetchPubConfig').then(() => {
      // Determine default login type based on config
      this.isMobileLogin = this.enableMobileRegister;
    });
  },
  methods: {
    fetchCaptcha() {
      if (this.$store.getters.getToken) {
        if (this.$route.path !== '/home') {
          this.$router.push('/home')
        }
      } else {
        this.captchaUuid = getUUID();

        Api.user.getCaptcha(this.captchaUuid, (res) => {
          if (res.status === 200) {
            const blob = new Blob([res.data], { type: res.data.type });
            this.captchaUrl = URL.createObjectURL(blob);
          } else {
            showDanger('Failed to load verification code, click to refresh');
          }
        });
      }
    },

    // Switch login type
    switchLoginType(type) {
      this.isMobileLogin = type === 'mobile';
      // Clear form
      this.form.username = '';
      this.form.mobile = '';
      this.form.password = '';
      this.form.captcha = '';
      this.fetchCaptcha();
    },

    // Encapsulate input validation logic
    validateInput(input, message) {
      if (!input.trim()) {
        showDanger(message);
        return false;
      }
      return true;
    },

    async login() {
      if (this.isMobileLogin) {
        // Mobile login validation
        if (!validateMobile(this.form.mobile, this.form.areaCode)) {
          showDanger('Please enter a valid phone number');
          return;
        }
        // Combine phone number as username
        this.form.username = this.form.areaCode + this.form.mobile;
      } else {
        // Username login validation
        if (!this.validateInput(this.form.username, 'Username cannot be empty')) {
          return;
        }
      }

      // Validate password
      if (!this.validateInput(this.form.password, 'Password cannot be empty')) {
        return;
      }
      // Validate captcha
      if (!this.validateInput(this.form.captcha, 'Verification code cannot be empty')) {
        return;
      }

      this.form.captchaId = this.captchaUuid
      Api.user.login(this.form, ({ data }) => {
        showSuccess('Login successful!');
        this.$store.commit('setToken', JSON.stringify(data.data));
        // Super admins land on the Overview dashboard; regular users on agents
        goToPage(data.data && data.data.superAdmin === 1 ? '/overview' : '/home');
      }, (err) => {
        showDanger(err.data.msg || 'Login failed')
        if (err.data != null && err.data.msg != null && err.data.msg.indexOf('verification code') > -1) {
          this.fetchCaptcha()
        }
      })

      // Refresh captcha
      setTimeout(() => {
        this.fetchCaptcha();
      }, 1000);
    },

    goToRegister() {
      goToPage('/register')
    },
    goToForgetPassword() {
      goToPage('/retrieve-password')
    } }
}
</script>
<style lang="scss" scoped>
@import './auth.scss';
</style>
