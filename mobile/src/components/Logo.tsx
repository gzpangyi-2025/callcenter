import React from 'react';
import Svg, { Defs, LinearGradient, Stop, G, Path, Text as SvgText } from 'react-native-svg';

interface LogoProps {
  width?: number | string;
  height?: number | string;
}

export default function Logo({ width = '100%', height = '100%' }: LogoProps) {
  return (
    <Svg width={width} height={height} viewBox="0 0 1280 584">
      <Defs>
        <LinearGradient id="trustfarBlue" x1="0" y1="1" x2="0.45" y2="0">
          <Stop offset="0" stopColor="#BFEAF1" />
          <Stop offset="0.42" stopColor="#00A8D4" />
          <Stop offset="1" stopColor="#0A2688" />
        </LinearGradient>
        <LinearGradient id="trustfarBlueRight" x1="0.2" y1="0" x2="0.7" y2="1">
          <Stop offset="0" stopColor="#BFEAF1" />
          <Stop offset="0.48" stopColor="#00A8D4" />
          <Stop offset="1" stopColor="#0A2688" />
        </LinearGradient>
      </Defs>
      <G fill="url(#trustfarBlue)">
        <Path d="M70 540 C82 311 217 143 425 73 C513 43 604 39 676 50 C528 111 378 242 310 540 Z" />
      </G>
      <G fill="url(#trustfarBlueRight)">
        <Path d="M704 55 C822 75 893 147 899 215 L821 215 C817 143 773 88 704 55 Z" />
        <Path d="M642 95 C731 110 791 160 797 215 L733 215 C728 166 693 126 642 95 Z" />
        <Path d="M598 130 C665 141 708 176 713 215 L665 215 C662 181 637 153 598 130 Z" />
      </G>
      <SvgText
        x="442"
        y="405"
        fontFamily="System"
        fontSize="122"
        fontStyle="italic"
        fontWeight="800"
        letterSpacing="10"
        fill="#000000"
      >
        银信科技
      </SvgText>
      <SvgText
        x="414"
        y="532"
        fontFamily="Arial"
        fontSize="74"
        fontStyle="italic"
        fontWeight="700"
        fill="#666666"
      >
        Trust&amp;far Technology
      </SvgText>
    </Svg>
  );
}
