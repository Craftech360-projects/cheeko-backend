#!/usr/bin/env python3
"""
Interactive Image to Binary Converter for LVGL
Converts images (PNG/JPG) to LVGL binary format with interactive prompts

Usage:
    python image_to_bin_converter.py
    
The script will ask you for:
    1. Color format (RGB565, RGB888, ARGB8888, XRGB8888)
    2. Dithering option (Yes/No) - for smoother gradients
    3. Image file path
    4. Output file path (optional)
"""

import os
import sys
from enum import Enum
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("❌ Error: PIL (Pillow) package is not installed!")
    print("   Install it with: pip install Pillow")
    sys.exit(1)

try:
    import lz4.block
    LZ4_AVAILABLE = True
except ImportError:
    LZ4_AVAILABLE = False


# ============================================================================
# Dithering Pattern (Bayer 8x8 matrix for ordered dithering)
# ============================================================================

# Thresholds for RGB565 dithering (reduces color banding in gradients)
RED_THRESH = [
    1, 7, 3, 5, 0, 8, 2, 6,
    7, 1, 5, 3, 8, 0, 6, 2,
    3, 5, 0, 8, 2, 6, 1, 7,
    5, 3, 8, 0, 6, 2, 7, 1,
    0, 8, 2, 6, 1, 7, 3, 5,
    8, 0, 6, 2, 7, 1, 5, 3,
    2, 6, 1, 7, 3, 5, 0, 8,
    6, 2, 7, 1, 5, 3, 8, 0
]

GREEN_THRESH = [
    1, 3, 2, 2, 3, 1, 2, 2,
    2, 2, 0, 4, 2, 2, 4, 0,
    3, 1, 2, 2, 1, 3, 2, 2,
    2, 2, 4, 0, 2, 2, 0, 4,
    1, 3, 2, 2, 3, 1, 2, 2,
    2, 2, 0, 4, 2, 2, 4, 0,
    3, 1, 2, 2, 1, 3, 2, 2,
    2, 2, 4, 0, 2, 2, 0, 4
]

BLUE_THRESH = [
    5, 3, 8, 0, 6, 2, 7, 1,
    3, 5, 0, 8, 2, 6, 1, 7,
    8, 0, 6, 2, 7, 1, 5, 3,
    0, 8, 2, 6, 1, 7, 3, 5,
    6, 2, 7, 1, 5, 3, 8, 0,
    2, 6, 1, 7, 3, 5, 0, 8,
    7, 1, 5, 3, 8, 0, 6, 2,
    1, 7, 3, 5, 0, 8, 2, 6
]


# ============================================================================
# Helper Functions
# ============================================================================

def uint8_t(val) -> bytes:
    """Convert value to 1-byte little-endian"""
    return val.to_bytes(1, byteorder='little')


def uint16_t(val) -> bytes:
    """Convert value to 2-byte little-endian"""
    return val.to_bytes(2, byteorder='little')


def uint32_t(val) -> bytes:
    """Convert value to 4-byte little-endian"""
    try:
        return val.to_bytes(4, byteorder='little')
    except OverflowError:
        raise ValueError(f"overflow: {hex(val)}")


# ============================================================================
# Enumerations
# ============================================================================

class CompressMethod(Enum):
    """Compression methods supported"""
    NONE = 0x00
    LZ4 = 0x02


class ColorFormat(Enum):
    """Color formats supported by LVGL"""
    RGB565 = 0x12
    RGB888 = 0x0F
    ARGB8888 = 0x10
    XRGB8888 = 0x11
    
    @property
    def bpp(self) -> int:
        """Return bits per pixel for this color format"""
        cf_map = {
            ColorFormat.RGB565: 16,
            ColorFormat.RGB888: 24,
            ColorFormat.ARGB8888: 32,
            ColorFormat.XRGB8888: 32,
        }
        return cf_map.get(self, 0)
    
    @property
    def description(self) -> str:
        """Return human-readable description"""
        desc_map = {
            ColorFormat.RGB565: "16-bit color (65K colors, no alpha) - Best for ESP32",
            ColorFormat.RGB888: "24-bit true color (16M colors, no alpha)",
            ColorFormat.ARGB8888: "32-bit true color with transparency (16M colors + alpha)",
            ColorFormat.XRGB8888: "32-bit true color (16M colors, no alpha, 32-bit aligned)",
        }
        return desc_map.get(self, "Unknown format")


# ============================================================================
# Image Header Class
# ============================================================================

class LVGLImageHeader:
    """LVGL Image Header structure"""
    
    def __init__(self, cf: ColorFormat, w: int, h: int, stride: int = 0, flags: int = 0):
        self.cf = cf
        self.flags = flags
        self.w = w & 0xffff
        self.h = h & 0xffff
        
        if w > 0xffff or h > 0xffff:
            raise ValueError(f"Width/Height overflow: {w}x{h}")
        
        # Calculate stride (bytes per row)
        if stride == 0:
            self.stride = (self.w * self.cf.bpp + 7) // 8
        else:
            self.stride = stride
    
    @property
    def binary(self) -> bytearray:
        """Generate binary header"""
        binary = bytearray()
        binary += uint8_t(0x19)  # Magic number for LVGL version 9
        binary += uint8_t(self.cf.value)
        binary += uint16_t(self.flags)  # 16-bit flags
        binary += uint16_t(self.w)  # 16-bit width
        binary += uint16_t(self.h)  # 16-bit height
        binary += uint16_t(self.stride)  # 16-bit stride
        binary += uint16_t(0)  # 16-bit reserved
        return binary


# ============================================================================
# Compression Class
# ============================================================================

class LVGLCompressData:
    """Handle data compression"""
    
    def __init__(self, cf: ColorFormat, method: CompressMethod, raw_data: bytes = b''):
        self.blk_size = (cf.bpp + 7) // 8
        self.compress = method
        self.raw_data = raw_data
        self.raw_data_len = len(raw_data)
        self.compressed = self._compress(raw_data)
    
    def _compress(self, raw_data: bytes) -> bytearray:
        """Compress raw data"""
        if self.compress == CompressMethod.NONE:
            return raw_data
        
        if self.compress == CompressMethod.LZ4:
            if not LZ4_AVAILABLE:
                raise RuntimeError("LZ4 compression requested but lz4 package not installed")
            compressed = lz4.block.compress(raw_data, store_size=False)
        else:
            raise ValueError(f"Invalid compress method: {self.compress}")
        
        self.compressed_len = len(compressed)
        
        # Build compressed data with header
        bin_data = bytearray()
        bin_data += uint32_t(self.compress.value)
        bin_data += uint32_t(self.compressed_len)
        bin_data += uint32_t(self.raw_data_len)
        bin_data += compressed
        return bin_data


# ============================================================================
# Image Converter Class
# ============================================================================

class ImageToBinConverter:
    """Main converter class"""
    
    def __init__(self, color_format: ColorFormat = ColorFormat.RGB565, 
                 compress: CompressMethod = CompressMethod.NONE,
                 dithering: bool = False):
        self.cf = color_format
        self.compress = compress
        self.dithering = dithering
        self.w = 0
        self.h = 0
        self.data = bytearray()
    
    def load_image(self, filename: str):
        """Load image from file using PIL"""
        print(f"📷 Loading image: {filename}")
        
        # Open image with PIL
        img = Image.open(filename)
        self.w, self.h = img.size
        
        # Convert to RGBA for consistent processing
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
        
        print(f"   Size: {self.w} x {self.h} pixels")
        print(f"   Original format: {img.mode}")
        
        # Convert to LVGL format
        self._convert_pixels(img)
        
        return self
    
    def _convert_pixels(self, img):
        """Convert pixels to LVGL color format"""
        self.data = bytearray()
        pixels = img.load()  # Load pixel access object for faster access
        
        print(f"🔄 Converting to {self.cf.name}...")
        if self.dithering and self.cf == ColorFormat.RGB565:
            print("   Using dithering for smoother gradients")
        
        if self.cf == ColorFormat.RGB565:
            for y in range(self.h):
                for x in range(self.w):
                    r, g, b, a = pixels[x, y]
                    
                    # Pre-multiply with white background if alpha < 255
                    if a < 255:
                        r = (r * a + (255 - a) * 255) >> 8
                        g = (g * a + (255 - a) * 255) >> 8
                        b = (b * a + (255 - a) * 255) >> 8
                    
                    # Apply dithering if enabled
                    if self.dithering:
                        threshold_id = ((y & 7) << 3) + (x & 7)
                        r = min(r + RED_THRESH[threshold_id], 0xFF) & 0xF8
                        g = min(g + GREEN_THRESH[threshold_id], 0xFF) & 0xFC
                        b = min(b + BLUE_THRESH[threshold_id], 0xFF) & 0xF8
                    
                    # Convert to RGB565
                    color = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
                    self.data += uint16_t(color)
        
        elif self.cf == ColorFormat.RGB888:
            for y in range(self.h):
                for x in range(self.w):
                    r, g, b, a = pixels[x, y]
                    
                    # Pre-multiply with white background if alpha < 255
                    if a < 255:
                        r = (r * a + (255 - a) * 255) >> 8
                        g = (g * a + (255 - a) * 255) >> 8
                        b = (b * a + (255 - a) * 255) >> 8
                    
                    # RGB888: B, G, R order in memory
                    self.data += uint8_t(b)
                    self.data += uint8_t(g)
                    self.data += uint8_t(r)
        
        elif self.cf == ColorFormat.ARGB8888:
            for y in range(self.h):
                for x in range(self.w):
                    r, g, b, a = pixels[x, y]
                    
                    # ARGB8888: B, G, R, A order in memory
                    self.data += uint8_t(b)
                    self.data += uint8_t(g)
                    self.data += uint8_t(r)
                    self.data += uint8_t(a)
        
        elif self.cf == ColorFormat.XRGB8888:
            for y in range(self.h):
                for x in range(self.w):
                    r, g, b, a = pixels[x, y]
                    
                    # Pre-multiply with white background
                    if a < 255:
                        r = (r * a + (255 - a) * 255) >> 8
                        g = (g * a + (255 - a) * 255) >> 8
                        b = (b * a + (255 - a) * 255) >> 8
                    
                    # XRGB8888: B, G, R, 0xFF order in memory
                    self.data += uint8_t(b)
                    self.data += uint8_t(g)
                    self.data += uint8_t(r)
                    self.data += uint8_t(0xFF)
        
        print(f"   Data size: {len(self.data)} bytes")
    
    def save_bin(self, filename: str):
        """Save as LVGL binary file"""
        print(f"💾 Saving binary file: {filename}")
        
        # Create output directory if it doesn't exist
        output_dir = os.path.dirname(filename)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir)
        
        with open(filename, "wb") as f:
            # Set flags
            flags = 0
            if self.compress != CompressMethod.NONE:
                flags |= 0x08  # Compressed flag
            
            # Create and write header
            stride = (self.w * self.cf.bpp + 7) // 8
            header = LVGLImageHeader(self.cf, self.w, self.h, stride, flags=flags)
            f.write(header.binary)
            
            # Compress and write data
            compressed_data = LVGLCompressData(self.cf, self.compress, self.data)
            f.write(compressed_data.compressed)
        
        file_size = os.path.getsize(filename)
        
        print()
        print("=" * 60)
        print("✅ CONVERSION SUCCESSFUL!")
        print("=" * 60)
        print(f"📊 Image: {self.w} x {self.h} pixels")
        print(f"🎨 Format: {self.cf.name} ({self.cf.bpp}-bit)")
        print(f"📦 Compression: {self.compress.name}")
        if self.dithering and self.cf == ColorFormat.RGB565:
            print(f"✨ Dithering: Enabled")
        print(f"💾 Output file: {filename}")
        print(f"📏 File size: {file_size:,} bytes ({file_size / 1024:.2f} KB)")
        print("=" * 60)
        
        return self


# ============================================================================
# Interactive Prompts
# ============================================================================

def print_header():
    """Print welcome header"""
    print()
    print("=" * 60)
    print("  📷  LVGL Image to Binary Converter")
    print("=" * 60)
    print()


def get_color_format():
    """Ask user for color format"""
    print("🎨 SELECT COLOR FORMAT:")
    print()
    formats = list(ColorFormat)
    for i, fmt in enumerate(formats, 1):
        print(f"  {i}. {fmt.name:12} - {fmt.description}")
    print()
    
    while True:
        try:
            choice = input("Enter your choice (1-4) [default: 1 for RGB565]: ").strip()
            if not choice:
                choice = "1"
            
            idx = int(choice) - 1
            if 0 <= idx < len(formats):
                selected = formats[idx]
                print(f"✓ Selected: {selected.name}\n")
                return selected
            else:
                print("❌ Invalid choice. Please enter 1-4.\n")
        except (ValueError, KeyboardInterrupt):
            print("❌ Invalid input. Please enter a number (1-4).\n")


def get_dithering_option(color_format):
    """Ask user if they want dithering"""
    if color_format != ColorFormat.RGB565:
        return False
    
    print("✨ DITHERING OPTION (RGB565 only):")
    print()
    print("   What is dithering?")
    print("   ─────────────────")
    print("   RGB565 uses only 65,536 colors (vs 16 million in RGB888).")
    print("   When converting, smooth gradients can show visible 'bands'")
    print("   of color (like steps instead of smooth transitions).")
    print()
    print("   Dithering adds a tiny pattern to make gradients look smoother")
    print("   to the human eye. It's like adding noise to blend colors better.")
    print()
    print("   ✅ Use dithering if: Your image has gradients/sky/smooth colors")
    print("   ❌ Skip dithering if: Your image is pixel art/flat colors/icons")
    print()
    
    while True:
        choice = input("Enable dithering? (y/n) [default: n]: ").strip().lower()
        if not choice:
            choice = 'n'
        
        if choice in ['y', 'yes']:
            print("✓ Dithering enabled\n")
            return True
        elif choice in ['n', 'no']:
            print("✓ Dithering disabled\n")
            return False
        else:
            print("❌ Please enter 'y' or 'n'\n")


def get_compression_option():
    """Ask user if they want LZ4 compression"""
    if not LZ4_AVAILABLE:
        return CompressMethod.NONE
    
    print("📦 COMPRESSION OPTION:")
    print()
    print("   LZ4 compression can reduce file size (usually 20-50% smaller)")
    print("   Good for large images or limited storage.")
    print()
    
    while True:
        choice = input("Enable LZ4 compression? (y/n) [default: n]: ").strip().lower()
        if not choice:
            choice = 'n'
        
        if choice in ['y', 'yes']:
            print("✓ LZ4 compression enabled\n")
            return CompressMethod.LZ4
        elif choice in ['n', 'no']:
            print("✓ No compression\n")
            return CompressMethod.NONE
        else:
            print("❌ Please enter 'y' or 'n'\n")


def get_image_path():
    """Ask user for image file path"""
    print("📂 INPUT IMAGE:")
    print()
    
    while True:
        path = input("Enter image file path (PNG, JPG, etc.): ").strip()
        
        # Remove quotes if user pasted path with quotes
        path = path.strip('"').strip("'")
        
        # Expand ~ to home directory
        path = os.path.expanduser(path)
        
        if not path:
            print("❌ Please enter a file path\n")
            continue
        
        if not os.path.isfile(path):
            print(f"❌ File not found: {path}")
            print("   Please check the path and try again\n")
            continue
        
        # Check if it's an image file
        try:
            with Image.open(path) as img:
                print(f"✓ Found image: {os.path.basename(path)}\n")
                return path
        except Exception as e:
            print(f"❌ Not a valid image file: {e}\n")


def get_output_path(input_path, color_format):
    """Ask user for output file path or generate default"""
    print("💾 OUTPUT FILE:")
    print()
    
    # Generate default output name
    input_name = os.path.splitext(os.path.basename(input_path))[0]
    default_output = f"{input_name}_{color_format.name.lower()}.bin"
    
    print(f"   Default: {default_output}")
    output = input(f"Enter output file path [press Enter for default]: ").strip()
    
    if not output:
        output = default_output
    
    # Remove quotes if present
    output = output.strip('"').strip("'")
    
    # Expand ~ to home directory
    output = os.path.expanduser(output)
    
    # Add .bin extension if not present
    if not output.lower().endswith('.bin'):
        output += '.bin'
    
    print(f"✓ Output will be saved as: {output}\n")
    return output


# ============================================================================
# Main Function
# ============================================================================

def main():
    """Main interactive function"""
    try:
        print_header()
        
        # Get user choices
        color_format = get_color_format()
        dithering = get_dithering_option(color_format)
        compression = get_compression_option()
        input_path = get_image_path()
        output_path = get_output_path(input_path, color_format)
        
        print("─" * 60)
        print("🚀 Starting conversion...")
        print("─" * 60)
        print()
        
        # Convert image
        converter = ImageToBinConverter(
            color_format=color_format,
            compress=compression,
            dithering=dithering
        )
        converter.load_image(input_path)
        converter.save_bin(output_path)
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Conversion cancelled by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
